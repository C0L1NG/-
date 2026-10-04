"""Exercise the additive upgrade against populated legacy tables, not create_all."""

import os
import uuid
from decimal import Decimal
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url


@pytest.mark.asyncio
async def test_populated_legacy_upgrade_preserves_beneficiaries_and_wallet_opening():
    raw = os.getenv("TEST_DATABASE_URL")
    if not raw:
        pytest.skip("Set disposable TEST_DATABASE_URL ending in _test")
    url = make_url(raw)
    if not (url.database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must end in _test")
    schema = "upgrade_test_" + uuid.uuid4().hex[:12]
    connection = await asyncpg.connect(
        dsn=url.set(drivername="postgresql", query={}).render_as_string(hide_password=False)
    )
    migrations = sorted(
        (Path(__file__).resolve().parents[2] / "prisma/migrations").glob("*/migration.sql")
    )
    seller, parent, settled, pending = [uuid.uuid4() for _ in range(4)]
    try:
        await connection.execute(f'CREATE SCHEMA "{schema}"')
        await connection.execute(f'SET search_path TO "{schema}"')
        cutover = next(
            i
            for i, path in enumerate(migrations)
            if path.parent.name == "20261003000000_financial_lifecycle"
        )
        for migration in migrations[:cutover]:
            await connection.execute(migration.read_text())
        await connection.execute(
            "INSERT INTO users(id,referral_code) VALUES($1,'legacy-seller'),($2,'legacy-parent')",
            seller,
            parent,
        )
        await connection.execute(
            "INSERT INTO orders(id,order_no,customer_id,promoter_id,total_amount,profit_amount,payment_status,settlement_status,created_at) VALUES($1,'legacy-settled','c',$3,250,100,'paid','settled','2026-01-01'),($2,'legacy-pending','c',$3,250,100,'pending','pending','2026-01-01')",
            settled,
            pending,
            seller,
        )
        await connection.execute(
            "INSERT INTO wallets(user_id,balance,frozen_balance,total_earned) VALUES($1,50,20,70),($2,0,0,0)",
            seller,
            parent,
        )
        await connection.execute(
            "INSERT INTO commission_logs(order_id,recipient_id,role_type,rate,commission_amount) VALUES($1,$2,'promoter',0.70,70)",
            settled,
            seller,
        )
        await connection.execute(
            "INSERT INTO platform_commission_logs(order_id,rate,commission_amount) VALUES($1,0.30,30)",
            settled,
        )
        # Parent was bound after the original 70% settlement. Migration must trust logs.
        await connection.execute("UPDATE users SET parent_id=$2 WHERE id=$1", seller, parent)
        before = await connection.fetchval("SELECT clock_timestamp()")
        for migration in migrations[cutover:]:
            await connection.execute(migration.read_text())
        rows = {
            row["id"]: row
            for row in await connection.fetch(
                "SELECT id,attribution_parent_id,attribution_locked_at,paid_at FROM orders"
            )
        }
        assert rows[settled]["attribution_parent_id"] is None
        assert rows[pending]["attribution_parent_id"] == parent
        assert rows[settled]["attribution_locked_at"] >= before
        assert rows[settled]["paid_at"].year == 2026
        opening = await connection.fetchrow(
            "SELECT balance_delta,frozen_delta,earned_delta FROM wallet_movements WHERE user_id=$1 AND kind='opening'",
            seller,
        )
        assert tuple(opening.values()) == (Decimal("50"), Decimal("20"), Decimal("70"))
        platform = await connection.fetchrow("SELECT balance,total_earned FROM platform_wallets")
        assert tuple(platform.values()) == (Decimal("30"), Decimal("30"))
        assert await connection.fetchval("SELECT count(*) FROM commission_logs") == 1
    finally:
        await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await connection.close()
