import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text, update
from sqlalchemy.exc import DBAPIError
from test_financial_lifecycle import account, notice, seed

from app.db import make_session_factory
from app.models import WalletMovement
from app.payments import accept_payment_notice
from app.reconciliation import reconcile
from app.withdrawals import request_withdrawal


@pytest.mark.asyncio
async def test_restricted_runtime_role_can_settle_refund_and_hold_but_cannot_edit_logs(postgres):
    engine = postgres.kw["bind"]
    role = "runtime_test_" + uuid.uuid4().hex[:12]
    runtime_engine = None
    async with engine.begin() as connection:
        schema = await connection.scalar(text("SELECT current_schema()"))
        await connection.exec_driver_sql(
            f"CREATE ROLE {role} LOGIN PASSWORD 'isolated-test-role-password-32-only' NOSUPERUSER NOCREATEDB NOCREATEROLE"
        )
        await connection.exec_driver_sql(f'GRANT USAGE ON SCHEMA "{schema}" TO {role}')
        await connection.exec_driver_sql(
            f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {role}'
        )
        for table in (
            "users",
            "orders",
            "wallets",
            "platform_wallets",
            "payout_accounts",
            "withdrawals",
            "payment_inbox",
            "worker_health",
            "reconciliation_cases",
        ):
            await connection.exec_driver_sql(f'GRANT INSERT,UPDATE ON "{schema}".{table} TO {role}')
        for table in (
            "commission_logs",
            "platform_commission_logs",
            "wallet_movements",
            "payment_events",
            "refunds",
            "withdrawal_actions",
        ):
            await connection.exec_driver_sql(f'GRANT INSERT ON "{schema}".{table} TO {role}')
        for table in ("web_login_tickets", "auth_rate_limits"):
            await connection.exec_driver_sql(
                f'GRANT INSERT,UPDATE,DELETE ON "{schema}".{table} TO {role}'
            )
    try:
        url = engine.url.set(
            username=role, password="isolated-test-role-password-32-only", query={"schema": schema}
        )
        runtime, runtime_engine = make_session_factory(url.render_as_string(hide_password=False))
        seller, _, order = await seed(runtime)
        await accept_payment_notice(notice(order), runtime)
        payout = await account(runtime, seller.id)
        await request_withdrawal(
            seller.id, "agent", Decimal("5"), payout.id, "runtime-role-1", runtime
        )
        await accept_payment_notice(notice(order, "refunded"), runtime)
        assert await reconcile(runtime) == []
        async with runtime() as session:
            with pytest.raises(DBAPIError):
                await session.execute(update(WalletMovement).values(amount=Decimal("1")))
    finally:
        if runtime_engine is not None:
            await runtime_engine.dispose()
        async with engine.begin() as connection:
            await connection.exec_driver_sql(f"DROP OWNED BY {role}")
            await connection.exec_driver_sql(f"DROP ROLE {role}")
