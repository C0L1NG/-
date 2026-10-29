"""Synthetic local baseline, not a production capacity/SLA claim."""

import argparse
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.commission import process_order_commission  # noqa: E402
from app.exports import stream_audit_csv  # noqa: E402
from app.models import Order, User, Wallet  # noqa: E402
from app.queries.admin_network import network_page  # noqa: E402
from app.reconciliation import reconcile  # noqa: E402
from tools.test_database import temporary_database  # noqa: E402


async def synthetic_orders(factory, count):
    async with factory() as session:
        async with session.begin():
            root = User(referral_code="capacity-root-" + uuid.uuid4().hex)
            session.add(root)
            await session.flush()
            agents = [
                root,
                *[
                    User(referral_code="capacity-" + uuid.uuid4().hex, parent_id=root.id)
                    for _ in range(10)
                ],
            ]
            session.add_all(agents[1:])
            await session.flush()
            session.add_all(Wallet(user_id=agent.id) for agent in agents)
            orders = [
                Order(
                    order_no="CAP-" + uuid.uuid4().hex,
                    customer_id="synthetic",
                    promoter_id=agents[index % len(agents)].id,
                    total_amount=Decimal("250.00"),
                    profit_amount=Decimal("100.00"),
                    payment_status="paid",
                    paid_at=datetime.now(timezone.utc),
                )
                for index in range(count)
            ]
            session.add_all(orders)
            await session.flush()
            return [str(order.id) for order in orders]


async def run(count, concurrency, output):
    async with temporary_database() as factory:
        ids = await synthetic_orders(factory, count)
        limiter = asyncio.Semaphore(concurrency)
        timings = []

        async def settle(order_id):
            async with limiter:
                started = time.perf_counter()
                await process_order_commission(order_id, factory)
                timings.append((time.perf_counter() - started) * 1000)

        start = time.perf_counter()
        await asyncio.gather(*(settle(order_id) for order_id in ids))
        elapsed = time.perf_counter() - start
        start = time.perf_counter()
        issues = await reconcile(factory)
        audit_ms = (time.perf_counter() - start) * 1000
        assert issues == [], issues
        start = time.perf_counter()
        async with factory() as session:
            network = await network_page(session, None, 1, 20, None, "")
        network_ms = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        exported = sum(
            [len(chunk.encode()) async for chunk in stream_audit_csv(factory, "all", "")]
        )
        export_ms = (time.perf_counter() - start) * 1000
        timings.sort()
        result = {
            "environment": "synthetic disposable PostgreSQL, local machine; not production capacity",
            "orders": count,
            "concurrency": concurrency,
            "settlementSeconds": round(elapsed, 3),
            "ordersPerSecond": round(count / elapsed, 2),
            "settlementP95Ms": round(timings[min(len(timings) - 1, int(len(timings) * 0.95))], 2),
            "reconciliationMs": round(audit_ms, 2),
            "discrepancies": len(issues),
            "networkQueryMs": round(network_ms, 2),
            "rootTeams": network["total"],
            "exportMs": round(export_ms, 2),
            "exportBytes": exported,
        }
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--orders", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.orders <= 10000 or not 1 <= args.concurrency <= 32:
        parser.error("orders: 1..10000, concurrency: 1..32")
    asyncio.run(run(args.orders, args.concurrency, args.output))
