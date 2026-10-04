"""Regression cases for R2-01..10, against migrations on real PostgreSQL."""

import asyncio
import csv
import hashlib
import hmac
import io
import json
import time
import uuid
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError
from test_financial_lifecycle import SETTINGS, notice, seed, token

from app.db import begin_read_snapshot, get_session
from app.errors import APIError
from app.exports import csv_line
from app.factory import create_app
from app.models import (
    PaymentEvent,
    PaymentInbox,
    PayoutAccount,
    User,
    UserRole,
    Wallet,
    Withdrawal,
    WithdrawalAction,
)
from app.payments import accept_payment_notice, process_payment_inbox, retry_payment_inbox
from app.queries.admin_metrics import overview_totals
from app.reconciliation import reconcile
from app.withdrawals import request_withdrawal, review_withdrawal


async def payout(factory, seller, amount="70.00", key=None):
    async with factory() as session:
        async with session.begin():
            account = await session.scalar(
                select(PayoutAccount).where(PayoutAccount.user_id == seller.id)
            )
            if not account:
                account = PayoutAccount(
                    user_id=seller.id,
                    provider="wechat",
                    account_reference=seller.wechat_open_id,
                    label="微信零钱",
                    verified=True,
                )
                session.add(account)
                await session.flush()
            account_id = account.id
    return await request_withdrawal(
        seller.id, "agent", Decimal(amount), account_id, key or uuid.uuid4().hex, factory
    )


async def admins(factory):
    async with factory() as session:
        async with session.begin():
            users = [User(role=UserRole.ADMIN, display_name=f"Admin {i}") for i in range(2)]
            session.add_all(users)
            await session.flush()
            return users


@pytest.mark.asyncio
async def test_r2_refund_debt_blocks_start_and_details_expose_risk(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    item = await payout(postgres, seller)
    await accept_payment_notice(notice(order, "refunded"), postgres)
    admin, _ = await admins(postgres)
    with pytest.raises(APIError) as error:
        await review_withdrawal(item.id, admin.id, "start", None, postgres)
    assert error.value.code == "REFUND_DEBT_BLOCKS_PAYOUT"
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        details = await client.get(
            f"/api/admin/withdrawals/{item.id}/payout-details",
            headers={"Authorization": "Bearer " + token(admin.id, "admin")},
        )
        assert details.status_code == 200
        assert details.json()["debtBalance"] == "70.00" and details.json()["payoutBlocked"]
        assert (
            await client.get(
                f"/api/admin/withdrawals/{item.id}/payout-details",
                headers={"Authorization": "Bearer " + token(seller.id)},
            )
        ).status_code == 401
    await review_withdrawal(item.id, admin.id, "reject", "refund-risk", postgres)
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_r2_claim_is_exclusive_and_history_is_immutable(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    item = await payout(postgres, seller)
    first, second = await admins(postgres)

    async def claim(admin):
        try:
            return await review_withdrawal(item.id, admin.id, "start", None, postgres)
        except APIError as error:
            return error.code

    results = await asyncio.gather(claim(first), claim(second))
    winner = next(result for result in results if isinstance(result, Withdrawal))
    assert "WITHDRAWAL_CLAIMED_BY_ANOTHER_ADMIN" in results
    assert winner.version == 1
    loser = second if winner.claimed_by == first.id else first
    with pytest.raises(APIError) as error:
        await review_withdrawal(item.id, loser.id, "confirm", "channel-success-01", postgres)
    assert error.value.code == "WITHDRAWAL_CLAIMED_BY_ANOTHER_ADMIN"
    same = await review_withdrawal(item.id, winner.claimed_by, "start", None, postgres)
    assert same.version == 1
    with pytest.raises(APIError) as error:
        await review_withdrawal(
            item.id,
            winner.claimed_by,
            "confirm",
            "channel-success-01",
            postgres,
            expected_version=0,
        )
    assert error.value.code == "WITHDRAWAL_VERSION_CONFLICT"
    await review_withdrawal(
        item.id, winner.claimed_by, "confirm", "channel-success-01", postgres, expected_version=1
    )
    async with postgres() as session:
        assert await session.scalar(select(func.count()).select_from(WithdrawalAction)) == 2
        with pytest.raises(DBAPIError):
            await session.execute(update(WithdrawalAction).values(reason="tampered"))
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_r2_identical_rejection_reasons_are_not_transfer_ids(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    first, second = await payout(postgres, seller, "10.00"), await payout(postgres, seller, "10.00")
    admin, _ = await admins(postgres)
    for item in (first, second):
        result = await review_withdrawal(item.id, admin.id, "reject", "same-reason", postgres)
        assert result.payout_reference is None and result.rejection_reason == "same-reason"
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert wallet.balance == Decimal("70.00") and wallet.frozen_balance == 0
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_r2_verified_receipt_survives_failure_and_recovers_without_webhook(postgres):
    seller, parent, order = await seed(postgres, True, wallet=False)
    value = notice(order)
    with pytest.raises(ValueError):
        await accept_payment_notice(value, postgres)
    async with postgres() as session:
        async with session.begin():
            inbox = await session.scalar(select(PaymentInbox))
            assert (
                inbox.status == "failed"
                and inbox.attempts == 1
                and inbox.last_error == "ValueError"
            )
            assert await session.scalar(select(func.count()).select_from(PaymentEvent)) == 0
            session.add(Wallet(user_id=parent.id))
            inbox.next_attempt_at = func.now()
    assert await retry_payment_inbox(postgres) == {"attempted": 1, "failed": 0}
    async with postgres() as session:
        inbox = await session.scalar(select(PaymentInbox))
        assert inbox.status == "processed" and inbox.attempts == 2
        assert (await process_payment_inbox(inbox.id, postgres))["status"] == "already_processed"
        with pytest.raises(DBAPIError):
            await session.execute(update(PaymentInbox).values(payload={"forged": True}))
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_r2_reconciliation_detects_fake_paid_state(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    item = await payout(postgres, seller)
    async with postgres() as session:
        async with session.begin():
            await session.execute(
                update(Withdrawal).where(Withdrawal.id == item.id).values(status="paid")
            )
    assert any(
        f"Withdrawal {item.id}: status differs" in issue for issue in await reconcile(postgres)
    )


@pytest.mark.asyncio
async def test_r2_report_reads_one_snapshot_during_concurrent_payment(postgres):
    _, _, order = await seed(postgres)
    request = SimpleNamespace(
        method="GET", app=SimpleNamespace(state=SimpleNamespace(session_factory=postgres))
    )
    generator = get_session(request)
    session = await anext(generator)
    await begin_read_snapshot(session)

    class Interleaved:
        fired = False

        async def scalar(self, statement):
            result = await session.scalar(statement)
            if not self.fired:
                self.fired = True
                await accept_payment_notice(notice(order), postgres)
            return result

        async def execute(self, statement):
            return await session.execute(statement)

    try:
        overview = await overview_totals(Interleaved(), "all")
        assert (
            overview["platformTotalRevenue"]
            == overview["agentCommissionPool"]
            == overview["totalGmv"]
            == "0.00"
        )
    finally:
        await generator.aclose()
    async with postgres() as fresh:
        overview = await overview_totals(fresh, "all")
        assert (
            overview["platformTotalRevenue"],
            overview["agentCommissionPool"],
            overview["totalGmv"],
        ) == ("30.00", "70.00", "250.00")


def test_r2_csv_negative_money_is_numeric_but_external_text_is_escaped():
    values = next(
        csv.reader(
            io.StringIO(
                csv_line([Decimal("-30.00"), "-30.00", "=cmd()", "+danger", "@danger", "normal"])
            )
        )
    )
    assert values == ["-30.00", "'-30.00", "'=cmd()", "'+danger", "'@danger", "normal"]
    assert Decimal(values[0]) == Decimal("-30.00")


def signed_headers(body, client, secret="b" * 32):
    timestamp = str(int(time.time()))
    raw = json.dumps(body).encode()
    canonical = "\n".join(
        (timestamp, "POST", "/api/auth/admin/login", client, hashlib.sha256(raw).hexdigest())
    )
    return raw, {
        "Content-Type": "application/json",
        "X-BFF-Client": client,
        "X-BFF-Timestamp": timestamp,
        "X-BFF-Signature": hmac.new(
            secret.encode(), canonical.encode(), hashlib.sha256
        ).hexdigest(),
    }


@pytest.mark.asyncio
async def test_r2_shared_limits_isolate_signed_clients_and_reject_spoofing(postgres):
    settings = replace(SETTINGS, bff_context_secret="b" * 32)
    apps = [create_app(settings, session_factory=postgres) for _ in range(2)]
    clients = [
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gateway")
        for app in apps
    ]
    try:
        for i in range(20):
            raw, headers = signed_headers({"username": "attacker", "password": "bad"}, "a" * 64)
            assert (
                await clients[i % 2].post("/api/auth/admin/login", content=raw, headers=headers)
            ).status_code == 401
        assert (
            await clients[0].post("/api/auth/admin/login", content=raw, headers=headers)
        ).status_code == 429
        raw, headers = signed_headers({"username": "other", "password": "bad"}, "c" * 64)
        assert (
            await clients[1].post("/api/auth/admin/login", content=raw, headers=headers)
        ).status_code == 401
        headers["X-BFF-Signature"] = "0" * 64
        assert (
            await clients[0].post("/api/auth/admin/login", content=raw, headers=headers)
        ).json()["code"] == "INVALID_BFF_CONTEXT"
        # Arbitrary X-Forwarded-For never overrides the network peer identity.
        for i in range(20):
            response = await clients[i % 2].post(
                "/api/auth/admin/login",
                json={"username": "direct", "password": "bad"},
                headers={"X-Forwarded-For": f"1.2.3.{i}"},
            )
            assert response.status_code == 401
        assert (
            await clients[0].post(
                "/api/auth/admin/login", json={"username": "direct", "password": "bad"}
            )
        ).status_code == 429
    finally:
        for client in clients:
            await client.aclose()


@pytest.mark.asyncio
async def test_r2_refund_queries_use_the_user_index(postgres):
    seller, _, _ = await seed(postgres)
    other = (await seed(postgres))[0]
    async with postgres() as session:
        async with session.begin():
            await session.execute(
                text("""INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta)
                SELECT :account,CAST(:owner AS uuid),'perf:'||n,'refund',0,0 FROM generate_series(1,50000) n"""),
                {"account": str(other.id), "owner": str(other.id)},
            )
            await session.execute(
                text(
                    "INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta) VALUES (:account,CAST(:owner AS uuid),'target','refund',0,0)"
                ),
                {"account": str(seller.id), "owner": str(seller.id)},
            )
            await session.execute(text("ANALYZE wallet_movements"))
            plan = "\n".join(
                (
                    await session.scalars(
                        text(
                            "EXPLAIN SELECT * FROM wallet_movements WHERE user_id=CAST(:owner AS uuid) AND kind='refund' AND created_at>=now()-interval '1 day'"
                        ),
                        {"owner": str(seller.id)},
                    )
                ).all()
            )
            assert "wallet_movements_user_kind_time_idx" in plan and "Seq Scan" not in plan


@pytest.mark.asyncio
async def test_r2_refund_during_processing_records_real_payment_and_retains_debt(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    item = await payout(postgres, seller)
    admin, _ = await admins(postgres)
    await review_withdrawal(item.id, admin.id, "start", None, postgres)
    await accept_payment_notice(notice(order, "refunded"), postgres)
    # This receipt represents an already completed external payment, not a new dispatch.
    result = await review_withdrawal(item.id, admin.id, "confirm", "real-channel-receipt", postgres)
    assert result.status == "paid"
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert wallet.frozen_balance == 0 and wallet.debt_balance == Decimal("70.00")
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_r2_successful_transfer_references_remain_unique(postgres):
    seller, _, order = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    admin, _ = await admins(postgres)
    first, second = await payout(postgres, seller, "10.00"), await payout(postgres, seller, "10.00")
    for item in (first, second):
        await review_withdrawal(item.id, admin.id, "start", None, postgres)
    await review_withdrawal(first.id, admin.id, "confirm", "unique-success-receipt", postgres)
    with pytest.raises(DBAPIError):
        await review_withdrawal(second.id, admin.id, "confirm", "unique-success-receipt", postgres)
    async with postgres() as session:
        assert (await session.get(Withdrawal, second.id)).status == "processing"
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert wallet.frozen_balance == Decimal("10.00")
    assert await reconcile(postgres) == []


def test_r2_financial_success_contracts_have_response_models():
    app = create_app(SETTINGS, session_factory=lambda: None)
    schema = app.openapi()
    for path in [
        "/api/auth/admin/login",
        "/api/auth/web/exchange",
        "/api/payments/webhook",
        "/api/admin/orders",
        "/api/admin/orders/{order_id}/settle",
    ]:
        status = "201" if path == "/api/admin/orders" else "200"
        assert schema["paths"][path]["post"]["responses"][status]["content"]["application/json"][
            "schema"
        ]["$ref"]


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["beneficiary", "refund", "orphan"])
async def test_r2_business_reconciliation_finds_injected_errors(postgres, corruption):
    seller, _, order = await seed(postgres)
    other = (await seed(postgres))[0]
    await accept_payment_notice(notice(order), postgres)
    if corruption == "refund":
        await accept_payment_notice(notice(order, "refunded"), postgres)
    async with postgres() as session:
        async with session.begin():
            # Intentional privileged corruption in a disposable schema only.
            if corruption == "beneficiary":
                await session.execute(
                    text("ALTER TABLE commission_logs DISABLE TRIGGER commission_logs_append_only")
                )
                await session.execute(
                    text(
                        "UPDATE commission_logs SET recipient_id=CAST(:recipient AS uuid) WHERE order_id=CAST(:order AS uuid)"
                    ),
                    {"recipient": str(other.id), "order": str(order.id)},
                )
                await session.execute(
                    text("ALTER TABLE commission_logs ENABLE TRIGGER commission_logs_append_only")
                )
            elif corruption == "refund":
                await session.execute(
                    text("ALTER TABLE refunds DISABLE TRIGGER refunds_append_only")
                )
                await session.execute(
                    text(
                        "UPDATE refunds SET platform_amount=1 WHERE order_id=CAST(:order AS uuid)"
                    ),
                    {"order": str(order.id)},
                )
                await session.execute(
                    text("ALTER TABLE refunds ENABLE TRIGGER refunds_append_only")
                )
            else:
                await session.execute(
                    text(
                        "INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta,earned_delta) VALUES (:account,CAST(:owner AS uuid),'missing-business','commission',0,0,0)"
                    ),
                    {"account": str(seller.id), "owner": str(seller.id)},
                )
    issues = await reconcile(postgres)
    message = {
        "beneficiary": "beneficiaries/rates",
        "refund": "refund record differs",
        "orphan": "orphaned business",
    }[corruption]
    assert any(message in issue for issue in issues)
