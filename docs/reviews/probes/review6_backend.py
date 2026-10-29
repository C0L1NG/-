"""Review-only probe; disposable test schemas or mocked browser API, no real payments."""

# ruff: noqa: E402
import asyncio
import json
import os
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(root / "python_backend"), str(root / "python_backend/tests")]
from sqlalchemy import select, text
from app.schema_inventory import schema_inventory, differences
from app.db import make_session_factory
from app.factory import create_app
from app.models import Order, Wallet
from app.payments import accept_payment_notice
from tools.test_database import temporary_database
from test_financial_lifecycle import seed, notice, SETTINGS, token
import httpx


async def main():
    output = {}
    async with temporary_database() as factory:
        async with factory() as s:
            async with s.begin():
                before = await schema_inventory(s)
                target = next(
                    x for x in before["triggers"] if x["object"] == "wallet_movements"
                )
                await s.execute(
                    text(
                        f'ALTER TABLE wallet_movements DISABLE TRIGGER "{target["name"]}"'
                    )
                )
                after = await schema_inventory(s)
                enabled = await s.scalar(
                    text("SELECT tgenabled FROM pg_trigger WHERE tgname=:name"),
                    {"name": target["name"]},
                )
                output["disabled_trigger"] = {
                    "trigger": target["name"],
                    "state": enabled.decode()
                    if isinstance(enabled, bytes)
                    else enabled,
                    "inventory_differences": differences(before, after),
                }
                await s.rollback()
        seller, _, order = await seed(factory)
        async with factory() as s:
            schema = await s.scalar(text("SELECT current_schema()"))
        limited, engine = make_session_factory(
            os.environ["TEST_DATABASE_URL"]
            + f"?schema={schema}&connection_limit=1&pool_timeout=1"
        )
        app = create_app(SETTINGS, session_factory=limited)
        try:
            start = time.perf_counter()
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/api/agent/payout-accounts",
                    json={"provider": "wechat"},
                    headers={"Authorization": "Bearer " + token(seller.id)},
                )
            output["one_connection_write"] = {
                "status": response.status_code,
                "response": response.json(),
                "elapsed_seconds": round(time.perf_counter() - start, 3),
            }
        finally:
            await engine.dispose()
        bad = notice(order, "refunded").model_copy(update={"transactionId": "x" * 128})
        valid = notice(order, "refunded")
        outcomes = []
        for label, value in [
            ("invalid_refund", bad),
            ("valid_refund_before_paid", valid),
            ("paid", notice(order)),
            ("retry_valid_refund", valid),
        ]:
            try:
                result = await accept_payment_notice(value, factory)
                outcomes.append({"step": label, "result": result})
            except Exception as e:
                outcomes.append(
                    {"step": label, "error": getattr(e, "code", type(e).__name__)}
                )
        async with factory() as s:
            current = await s.get(Order, order.id)
            wallet = await s.scalar(select(Wallet).where(Wallet.user_id == seller.id))
            output["invalid_refund_poison"] = {
                "sequence": outcomes,
                "payment_status": current.payment_status.value,
                "refund_pending": current.refund_pending,
                "balance": str(wallet.balance),
            }
    print(json.dumps(output, indent=2))
    (root / "docs/reviews/evidence/review6-backend-probes.json").write_text(
        json.dumps(output, indent=2) + "\n"
    )


asyncio.run(main())
