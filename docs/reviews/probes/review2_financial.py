"""Second-review fault probes. Only use a disposable TEST_DATABASE_URL ending in _test.

These assertions document current behavior, including defects; they are not acceptance tests.
Run from python_backend: .venv/bin/python ../docs/reviews/probes/review2_financial.py
Each probe uses the existing temporary-schema fixture and cleans up after itself.
"""

import asyncio
import csv
import io
import json
import sys
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "python_backend"), str(ROOT / "python_backend/tests")]
import httpx
from sqlalchemy import select, func, update
from conftest import postgres
from test_financial_lifecycle import SETTINGS, seed, notice, accept, account
from app.factory import create_app
from app.models import (
    User,
    UserRole,
    Wallet,
    Order,
    PaymentEvent,
    PaymentStatus,
    SettlementStatus,
    Withdrawal,
)
from app.security import hash_password
from app.withdrawals import request_withdrawal, review_withdrawal
from app.reconciliation import reconcile
from app.queries.admin_metrics import overview_totals
from app.exports import csv_line

fresh = asynccontextmanager(postgres.__wrapped__)


async def admin(factory, name):
    async with factory() as session:
        async with session.begin():
            user = User(
                role=UserRole.ADMIN,
                login_name=name,
                password_hash=hash_password("review-password-123"),
            )
            session.add(user)
            await session.flush()
            return user


async def shared_gateway_limit():
    async with fresh() as factory:
        await admin(factory, "owner")
        app = create_app(SETTINGS, session_factory=factory)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 8888)),
            base_url="http://test",
        ) as client:
            results = []
            for index in range(20):
                r = await client.post(
                    "/api/auth/admin/login",
                    json={"username": "missing", "password": "incorrect"},
                    headers={"X-Forwarded-For": f"192.0.2.{index + 1}"},
                )
                results.append(r.status_code)
            valid = await client.post(
                "/api/auth/admin/login",
                json={"username": "owner", "password": "review-password-123"},
                headers={"X-Forwarded-For": "192.0.2.200"},
            )
        assert results == [401] * 20 and valid.status_code == 429
        return {
            "prior_invalid_requests": len(results),
            "different_end_user_valid_login": valid.status_code,
            "body": valid.json(),
        }


async def failed_event_recovery():
    async with fresh() as factory:
        seller, parent, order = await seed(factory, True, wallet=False)
        failure = None
        try:
            await accept(factory, notice(order))
        except ValueError as exc:
            failure = type(exc).__name__
        # Repair the transient local fault. The provided recovery query still cannot find this paid order.
        async with factory() as session:
            async with session.begin():
                session.add(Wallet(user_id=parent.id))
        async with factory() as session:
            state = await session.get(Order, order.id)
            events = await session.scalar(
                select(func.count()).select_from(PaymentEvent)
            )
            retry_ids = (
                await session.scalars(
                    select(Order.id).where(
                        Order.payment_status == PaymentStatus.PAID,
                        Order.settlement_status == SettlementStatus.PENDING,
                    )
                )
            ).all()
            assert (
                state.payment_status == PaymentStatus.PENDING
                and events == 0
                and not retry_ids
            )
            return {
                "processing_error": failure,
                "stored_payment_status": state.payment_status.value,
                "durable_events": events,
                "recoverable_by_retry_settlements": len(retry_ids),
            }


async def withdrawal_after_refund():
    async with fresh() as factory:
        seller, _, order = await seed(factory)
        owner = await admin(factory, "owner")
        await accept(factory, notice(order))
        payout = await account(factory, seller.id)
        w = await request_withdrawal(
            seller.id,
            "agent",
            Decimal("70"),
            payout.id,
            "review-refunded-withdrawal",
            factory,
        )
        await accept(factory, notice(order, "refunded"))
        started = await review_withdrawal(w.id, owner.id, "start", None, factory)
        async with factory() as session:
            wallet = await session.scalar(
                select(Wallet).where(Wallet.user_id == seller.id)
            )
            assert started.status == "processing" and wallet.debt_balance == Decimal(
                "70"
            )
            return {
                "status_after_refund_then_start": started.status,
                "frozen": str(wallet.frozen_balance),
                "debt": str(wallet.debt_balance),
                "earned": str(wallet.total_earned),
            }


async def reconciliation_blind_spot():
    async with fresh() as factory:
        seller, _, order = await seed(factory)
        await accept(factory, notice(order))
        payout = await account(factory, seller.id)
        w = await request_withdrawal(
            seller.id,
            "agent",
            Decimal("50"),
            payout.id,
            "review-mismatch-withdrawal",
            factory,
        )
        async with factory() as session:
            async with session.begin():
                # Fault injection: status says paid, but no withdrawal_paid movement exists.
                await session.execute(
                    update(Withdrawal)
                    .where(Withdrawal.id == w.id)
                    .values(
                        status="paid", payout_reference="injected-inconsistent-state"
                    )
                )
        mismatches = await reconcile(factory)
        assert mismatches == []
        return {
            "injected_fault": "paid withdrawal without frozen debit",
            "reconcile_findings": mismatches,
        }


async def mixed_read_snapshot():
    async with fresh() as factory:
        _, _, order = await seed(factory)
        async with factory() as session:

            class Interleave:
                def __init__(self):
                    self.n = 0

                async def scalar(self, *args, **kwargs):
                    result = await session.scalar(*args, **kwargs)
                    self.n += 1
                    if self.n == 1:
                        await accept(factory, notice(order))
                    return result

                async def execute(self, *args, **kwargs):
                    return await session.execute(*args, **kwargs)

            result = await overview_totals(Interleave(), "all")
            assert (
                result["platformTotalRevenue"] == "0.00"
                and result["agentCommissionPool"] == "70.00"
            )
            return result


async def processing_claims():
    async with fresh() as factory:
        seller, _, order = await seed(factory)
        a, b = await admin(factory, "a"), await admin(factory, "b")
        await accept(factory, notice(order))
        payout = await account(factory, seller.id)
        w = await request_withdrawal(
            seller.id,
            "agent",
            Decimal("10"),
            payout.id,
            "review-two-operators",
            factory,
        )
        first, second = await asyncio.gather(
            review_withdrawal(w.id, a.id, "start", None, factory),
            review_withdrawal(w.id, b.id, "start", None, factory),
        )
        assert first.status == second.status == "processing"
        await review_withdrawal(
            w.id, b.id, "confirm", "review-transfer-success", factory
        )
        async with factory() as session:
            final = await session.get(Withdrawal, w.id)
            return {
                "start_results": [first.status, second.status],
                "final_reviewer_is_b": final.reviewed_by == b.id,
            }


async def rejection_reason_collision():
    from sqlalchemy.exc import IntegrityError

    async with fresh() as factory:
        seller, _, order = await seed(factory)
        owner = await admin(factory, "owner")
        await accept(factory, notice(order))
        payout = await account(factory, seller.id)
        first = await request_withdrawal(
            seller.id, "agent", Decimal("10"), payout.id, "review-reject-a", factory
        )
        second = await request_withdrawal(
            seller.id, "agent", Decimal("10"), payout.id, "review-reject-b", factory
        )
        reason = "收款账户信息不符合要求"
        await review_withdrawal(first.id, owner.id, "reject", reason, factory)
        failure = None
        try:
            await review_withdrawal(second.id, owner.id, "reject", reason, factory)
        except IntegrityError as exc:
            failure = type(exc).__name__
        async with factory() as session:
            final = await session.get(Withdrawal, second.id)
            wallet = await session.scalar(
                select(Wallet).where(Wallet.user_id == seller.id)
            )
            assert failure == "IntegrityError" and final.status == "pending"
            return {
                "first_status": "rejected",
                "second_error": failure,
                "second_status": final.status,
                "remaining_frozen": str(wallet.frozen_balance),
            }


async def refund_query_plan():
    from sqlalchemy import text

    async with fresh() as factory:
        seller, other, _ = await seed(factory, True)
        async with factory() as session:
            async with session.begin():
                await session.execute(
                    text(
                        "INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta) SELECT :key,cast(:owner as uuid),'probe-'||g,'refund',0,0 FROM generate_series(1,50000) g"
                    ),
                    {"key": str(other.id), "owner": str(other.id)},
                )
                await session.execute(
                    text(
                        "INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta) VALUES(:key,cast(:owner as uuid),'target','refund',0,0)"
                    ),
                    {"key": str(seller.id), "owner": str(seller.id)},
                )
                await session.execute(text("ANALYZE wallet_movements"))
            plan = (
                await session.execute(
                    text(
                        "EXPLAIN (ANALYZE,FORMAT JSON) SELECT sum(earned_delta) FROM wallet_movements WHERE user_id=cast(:owner as uuid) AND kind='refund' AND created_at >= CURRENT_DATE"
                    ),
                    {"owner": str(seller.id)},
                )
            ).scalar()
            return plan[0]["Plan"]


async def main():
    output = {}
    for name, fn in [
        ("shared_gateway_login_limit", shared_gateway_limit),
        ("failed_payment_recovery", failed_event_recovery),
        ("refund_before_payout_start", withdrawal_after_refund),
        ("reconciliation_status_gap", reconciliation_blind_spot),
        ("concurrent_overview", mixed_read_snapshot),
        ("manual_payout_claim", processing_claims),
        ("refund_aggregation_plan", refund_query_plan),
        ("rejection_reason_collision", rejection_reason_collision),
    ]:
        output[name] = await fn()
        print(name + ": reproduced", file=sys.stderr)
    raw = next(csv.reader(io.StringIO(csv_line(["-30.00"]))))[0]
    try:
        Decimal(raw)
        numeric = True
    except Exception:
        numeric = False
    output["negative_csv_cell"] = {"cell": raw, "numeric_without_cleanup": numeric}
    target = ROOT / "docs/reviews/review2-evidence.json"
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
