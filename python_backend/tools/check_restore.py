"""Dump and restore a synthetic schema into a separate disposable PostgreSQL database."""

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import uuid
from decimal import Decimal
from pathlib import Path

import asyncpg
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.commission import process_order_commission  # noqa: E402
from app.db import make_session_factory  # noqa: E402
from app.models import Order, PayoutAccount, User, UserRole  # noqa: E402
from app.payments import PaymentNotice, accept_payment_notice  # noqa: E402
from app.reconciliation import reconcile  # noqa: E402
from app.schema_inventory import schema_inventory  # noqa: E402
from app.withdrawals import request_withdrawal, review_withdrawal  # noqa: E402
from tools.check_capacity import synthetic_orders  # noqa: E402
from tools.test_database import temporary_database  # noqa: E402


async def run(container, output):
    url = make_url(os.environ["TEST_DATABASE_URL"]).set(drivername="postgresql", query={})
    if not (url.database or "").endswith("_test"):
        raise ValueError("Refusing a non-test database")
    restored_name = "restore_" + uuid.uuid4().hex[:12] + "_test"
    admin = await asyncpg.connect(url.render_as_string(hide_password=False))
    restored_engine = None
    try:
        async with temporary_database() as factory:
            ids = await synthetic_orders(factory, 5)
            for order_id in ids:
                await process_order_commission(order_id, factory)
            await accept_payment_notice(
                PaymentNotice(
                    provider="restore",
                    eventId=uuid.uuid4().hex,
                    orderId=ids[-1],
                    type="refunded",
                    transactionId="synthetic-refund-" + uuid.uuid4().hex,
                    amount=Decimal("250.00"),
                ),
                factory,
            )
            async with factory() as session:
                async with session.begin():
                    order = await session.get(Order, uuid.UUID(ids[0]))
                    payout = PayoutAccount(
                        user_id=order.promoter_id,
                        provider="bank",
                        account_reference="vault_synthetic_restore",
                        label="Synthetic restore account",
                        verified=True,
                    )
                    admin_user = User(role=UserRole.ADMIN)
                    session.add_all([payout, admin_user])
                    await session.flush()
            first = await request_withdrawal(
                payout.user_id, "agent", Decimal("5.00"), payout.id, "restore-first-1", factory
            )
            await review_withdrawal(first.id, admin_user.id, "start", None, factory)
            await review_withdrawal(
                first.id,
                admin_user.id,
                "reject",
                None,
                factory,
                reason="Synthetic transfer rejected",
                failure_reference="synthetic-failure-receipt",
            )
            await request_withdrawal(
                payout.user_id, "agent", Decimal("5.00"), payout.id, "restore-pending-2", factory
            )
            assert await reconcile(factory) == []
            async with factory.kw["bind"].connect() as connection:
                schema = await connection.scalar(text("SELECT current_schema()"))
                before = await schema_inventory(connection)
            with tempfile.TemporaryFile() as backup:
                subprocess.run(
                    [
                        "docker",
                        "exec",
                        container,
                        "pg_dump",
                        "-U",
                        url.username,
                        "-d",
                        url.database,
                        "-n",
                        schema,
                        "-Fc",
                        "--no-owner",
                        "--no-acl",
                    ],
                    stdout=backup,
                    stderr=subprocess.PIPE,
                    check=True,
                )
                backup.seek(0)
                digest = hashlib.file_digest(backup, "sha256").hexdigest()
                await admin.execute(f'CREATE DATABASE "{restored_name}"')
                backup.seek(0)
                subprocess.run(
                    [
                        "docker",
                        "exec",
                        "-i",
                        container,
                        "pg_restore",
                        "-U",
                        url.username,
                        "-d",
                        restored_name,
                        "--exit-on-error",
                        "--no-owner",
                        "--no-acl",
                    ],
                    stdin=backup,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
            restored, restored_engine = make_session_factory(
                url.set(database=restored_name, query={"schema": schema}).render_as_string(
                    hide_password=False
                )
            )
            async with restored_engine.connect() as connection:
                after = await schema_inventory(connection)
                mismatch = {
                    kind: {"before": before[kind], "after": after[kind]}
                    for kind in before
                    if before[kind] != after[kind]
                }
                assert not mismatch, json.dumps(mismatch, indent=2)
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
                orders = await connection.scalar(text("SELECT count(*) FROM orders"))
                earnings = await connection.scalar(
                    text("SELECT total_earned FROM platform_wallets")
                )
                refunds = await connection.scalar(text("SELECT count(*) FROM refunds"))
                actions = await connection.scalar(text("SELECT count(*) FROM withdrawal_actions"))
                frozen = await connection.scalar(text("SELECT sum(frozen_balance) FROM wallets"))
            assert orders == 5 and earnings == 120 and refunds == 1 and actions == 2 and frozen == 5
            assert await reconcile(restored) == []
            result = {
                "source": "synthetic test data only",
                "ordersRestored": orders,
                "platformEarned": str(earnings),
                "refundsRestored": refunds,
                "withdrawalActionsRestored": actions,
                "agentFrozenBalance": str(frozen),
                "schemaObjectsMatch": True,
                "reconciliationDifferences": 0,
                "migrationRevision": version,
                "backupSha256": digest,
            }
            if output:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result))
    finally:
        if restored_engine is not None:
            await restored_engine.dispose()
        await admin.execute(f'DROP DATABASE IF EXISTS "{restored_name}" WITH (FORCE)')
        await admin.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--docker-container", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.docker_container, args.output))
