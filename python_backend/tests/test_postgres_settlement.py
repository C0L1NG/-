"""Real PostgreSQL settlement tests, enabled by a dedicated TEST_DATABASE_URL.

The URL must name a database ending in _test. Each run creates and drops its own
schema, so migrations and settlement never touch an application schema.
"""

import asyncio
import os
import uuid
from decimal import Decimal
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.commission import process_order_commission
from app.db import make_session_factory
from app.models import CommissionLog, Order, PaymentStatus, PlatformCommissionLog, SettlementStatus, User, Wallet

MIGRATIONS = Path(__file__).resolve().parents[2] / "prisma/migrations"


@pytest_asyncio.fixture
async def postgres():
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test")
    url = make_url(raw_url)
    if not (url.database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL database name must end in _test")
    clean_url = url.set(drivername="postgresql", query={})
    schema = "commission_test_" + uuid.uuid4().hex[:12]
    admin = await asyncpg.connect(dsn=clean_url.render_as_string(hide_password=False))
    factory = engine = None
    try:
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        await admin.execute(f'SET search_path TO "{schema}"')
        for migration in sorted(MIGRATIONS.glob("*/migration.sql")):
            await admin.execute(migration.read_text())
        factory, engine = make_session_factory(clean_url.set(query={"schema": schema})
            .render_as_string(hide_password=False))
        yield factory
    finally:
        if engine is not None:
            await engine.dispose()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("has_parent", [False, True])
async def test_concurrent_callbacks_credit_each_wallet_once(postgres, has_parent):
    async with postgres() as session:
        async with session.begin():
            parent = User(referral_code="PARENT-" + uuid.uuid4().hex[:8]) if has_parent else None
            if parent:
                session.add(parent)
                await session.flush()
            promoter = User(referral_code="PROMOTER-" + uuid.uuid4().hex[:8],
                parent_id=parent.id if parent else None)
            session.add(promoter)
            await session.flush()
            session.add(Wallet(user_id=promoter.id))
            if parent:
                session.add(Wallet(user_id=parent.id))
            await session.flush()
            order = Order(order_no="TEST-" + uuid.uuid4().hex,
                customer_id="integration-test", promoter_id=promoter.id,
                total_amount=Decimal("100.00"), profit_amount=Decimal("100.00"),
                payment_status=PaymentStatus.PAID,
                settlement_status=SettlementStatus.PENDING)
            session.add(order)
            await session.flush()
            order_id = str(order.id)

    results = await asyncio.gather(
        process_order_commission(order_id, postgres),
        process_order_commission(order_id, postgres),
    )
    assert sorted(result["status"] for result in results) == ["already_settled", "settled"]
    async with postgres() as session:
        final = await session.get(Order, uuid.UUID(order_id))
        assert final.settlement_status == SettlementStatus.SETTLED
        platform = await session.scalar(select(PlatformCommissionLog).where(
            PlatformCommissionLog.order_id == final.id))
        assert platform.commission_amount == Decimal("30.00")
        logs = (await session.scalars(select(CommissionLog).where(
            CommissionLog.order_id == final.id))).all()
        assert len(logs) == (2 if has_parent else 1)
        assert sum(log.commission_amount for log in logs) == Decimal("70.00")
        balances = (await session.execute(select(Wallet.user_id, Wallet.balance,
            Wallet.total_earned).where(Wallet.user_id.in_([
                promoter.id, *([parent.id] if parent else [])])))).all()
        by_owner = {owner: (balance, earned) for owner, balance, earned in balances}
        assert by_owner[promoter.id] == ((Decimal("49.00"),) * 2 if parent else (Decimal("70.00"),) * 2)
        if parent:
            assert by_owner[parent.id] == (Decimal("21.00"), Decimal("21.00"))
        assert await session.scalar(select(func.count()).select_from(PlatformCommissionLog)
            .where(PlatformCommissionLog.order_id == final.id)) == 1
