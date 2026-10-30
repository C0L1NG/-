import asyncio
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import func, select, update
from test_financial_lifecycle import SETTINGS, account, notice, seed, token
from test_second_review_regressions import admins

from app.commission import process_order_commission
from app.errors import APIError
from app.factory import create_app
from app.models import (
    CommissionLog,
    Order,
    PaymentInbox,
    PayoutAccount,
    User,
    UserRole,
    Wallet,
)
from app.payments import accept_payment_notice, process_payment_inbox
from app.payout_accounts import decide_payout_account, save_payout_account
from app.reconciliation import reconcile
from app.routers import auth
from app.wallets import move_account
from app.withdrawals import request_withdrawal


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["missing", "wrong_account", "wrong_amount"])
async def test_commission_movement_mapping_faults_are_detected(postgres, monkeypatch, corruption):
    from app import commission

    seller, _, order = await seed(postgres)
    outsider, _, _ = await seed(postgres)
    original = commission.move_account

    async def corrupt(session, owner, business_id, kind, amount):
        if owner == seller.id and kind == "commission":
            if corruption == "missing":
                return
            if corruption == "wrong_account":
                owner = outsider.id
            if corruption == "wrong_amount":
                amount += Decimal("1")
        return await original(session, owner, business_id, kind, amount)

    monkeypatch.setattr(commission, "move_account", corrupt)
    await accept_payment_notice(notice(order), postgres)
    issues = await reconcile(postgres)
    expected = "amount differs" if corruption == "wrong_amount" else "missing commission"
    assert any(
        str(order.id) in item and str(seller.id) in item and expected in item for item in issues
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["agent", "admin"])
async def test_ticket_created_before_logout_cannot_be_exchanged(postgres, role):
    async with postgres() as session:
        async with session.begin():
            user = User(role=UserRole(role), referral_code="ticket-" + uuid.uuid4().hex)
            session.add(user)
            await session.flush()
            user_id = user.id
    app = create_app(SETTINGS, session_factory=postgres)
    headers = {"Authorization": "Bearer " + token(user_id, role)}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        ticket = await client.post(
            "/api/auth/web-ticket" if role == "agent" else "/api/auth/admin/web-ticket",
            headers=headers,
        )
        assert ticket.status_code == 200
        await client.post(
            "/api/agent/logout" if role == "agent" else "/api/auth/admin/logout", headers=headers
        )
        result = await client.post(
            "/api/auth/web/exchange", json={"ticket": ticket.json()["ticket"]}
        )
        assert result.status_code == 401 and result.json()["code"] == "SESSION_REVOKED"


@pytest.mark.asyncio
async def test_operations_health_case_claim_and_resolution_are_admin_only(postgres):
    from app.models import ReconciliationCase
    from app.operations import persist_reconciliation, record_worker_health

    seller, _, _ = await seed(postgres)
    first, second = await admins(postgres)
    await record_worker_health(postgres, "payment-recovery")
    await record_worker_health(postgres, "financial-audit")
    await persist_reconciliation(postgres, ["Synthetic discrepancy"])
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer " + token(first.id, "admin")}
        assert (
            await client.get(
                "/api/admin/system-health", headers={"Authorization": "Bearer " + token(seller.id)}
            )
        ).status_code == 401
        health = (await client.get("/api/admin/system-health", headers=headers)).json()
        assert health["unresolvedCases"] == 1 and all(
            item["state"] == "healthy" for item in health["workers"]
        )
        case = (await client.get("/api/admin/reconciliation-cases", headers=headers)).json()[
            "items"
        ][0]
        endpoint = f"/api/admin/reconciliation-cases/{case['id']}/acknowledge"
        assert (await client.post(endpoint, headers=headers)).json()["status"] == "acknowledged"
        assert (
            await client.post(
                endpoint, headers={"Authorization": "Bearer " + token(second.id, "admin")}
            )
        ).status_code == 409
    await persist_reconciliation(postgres, [])
    async with postgres() as session:
        item = await session.get(ReconciliationCase, case["id"])
        assert item.status == "resolved" and item.resolved_at


@pytest.mark.asyncio
async def test_older_audit_result_cannot_overwrite_newer_case_state(postgres):
    from datetime import datetime, timedelta, timezone

    from app.models import ReconciliationCase
    from app.operations import persist_reconciliation

    now = datetime.now(timezone.utc)
    assert await persist_reconciliation(postgres, ["Latest discrepancy"], now)
    assert not await persist_reconciliation(postgres, [], now - timedelta(seconds=30))
    async with postgres() as session:
        cases = (await session.scalars(select(ReconciliationCase))).all()
        assert len(cases) == 1 and cases[0].status == "open"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["agent", "admin"])
async def test_wallet_identity_header_keeps_json_contract(postgres, role):
    seller, _, _ = await seed(postgres)
    owner = seller
    if role == "admin":
        owner, _ = await admins(postgres)
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/api/{role}/wallet", headers={"Authorization": "Bearer " + token(owner.id, role)}
        )
        assert response.status_code == 200
        assert response.headers["x-account-id"] == str(owner.id)
        assert set(response.json()) == {"balance", "frozenBalance", "totalEarned", "debtBalance"}


@pytest.mark.asyncio
async def test_late_logout_does_not_revoke_newer_session_and_accepts_bearer_case(
    postgres, monkeypatch
):
    seller, _, _ = await seed(postgres)
    validated, proceed = asyncio.Event(), asyncio.Event()
    original = auth.require_identity
    paused = False

    async def pause(*args):
        nonlocal paused
        identity = await original(*args)
        if not paused:
            paused = True
            validated.set()
            await proceed.wait()
        return identity

    monkeypatch.setattr(auth, "require_identity", pause)
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pending = asyncio.create_task(
            client.post(
                "/api/agent/logout", headers={"Authorization": "Bearer " + token(seller.id)}
            )
        )
        try:
            await asyncio.wait_for(validated.wait(), 3)
            async with postgres() as session:
                async with session.begin():
                    await session.execute(
                        update(User).where(User.id == seller.id).values(token_version=1)
                    )
        finally:
            proceed.set()
        assert (await pending).status_code == 200
        current = {"Authorization": "bearer " + token(seller.id, version=1)}
        assert (await client.get("/api/agent/referral", headers=current)).status_code == 200
        assert (await client.post("/api/agent/logout", headers=current)).status_code == 200
        assert (await client.get("/api/agent/referral", headers=current)).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("has_parent", [False, True])
async def test_concurrent_payment_refund_and_late_duplicates_converge(postgres, has_parent):
    seller, mentor, order = await seed(postgres, has_parent)
    await asyncio.gather(
        accept_payment_notice(notice(order), postgres),
        accept_payment_notice(notice(order, "refunded"), postgres),
        return_exceptions=True,
    )
    # Either receipt order converges without allowing a terminal refund to resurrect.
    await accept_payment_notice(notice(order), postgres)
    await accept_payment_notice(notice(order, "refunded"), postgres)
    async with postgres() as session:
        current = await session.get(Order, order.id)
        assert current.payment_status.value == "refunded" and not current.refund_pending
        for owner in [seller, *([mentor] if mentor else [])]:
            wallet = await session.scalar(select(Wallet).where(Wallet.user_id == owner.id))
            assert wallet.balance == 0 and wallet.debt_balance == 0 and wallet.total_earned == 0
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_refund_first_never_releases_commission_and_recovers_idempotently(postgres):
    seller, _, order = await seed(postgres)
    refund = notice(order, "refunded")
    with pytest.raises(APIError, match="ORDER_NOT_PAID"):
        await accept_payment_notice(refund, postgres)
    async with postgres() as session:
        current = await session.get(Order, order.id)
        assert current.refund_pending
        inbox = await session.scalar(
            select(PaymentInbox).where(PaymentInbox.event_id == refund.eventId)
        )
        inbox_id = inbox.id
    paid = await accept_payment_notice(notice(order), postgres)
    assert paid["status"] == "refunded"
    payout = await account(postgres, seller.id)
    with pytest.raises(APIError) as error:
        await request_withdrawal(
            seller.id, "agent", Decimal("1.00"), payout.id, "blocked-refund-1", postgres
        )
    assert error.value.code == "INSUFFICIENT_BALANCE"
    await process_payment_inbox(inbox_id, postgres)
    assert (await process_payment_inbox(inbox_id, postgres))["status"] == "already_processed"
    async with postgres() as session:
        assert await session.scalar(select(func.count()).select_from(CommissionLog)) == 0
        assert (
            await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        ).balance == 0
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_known_refund_blocks_manual_settlement_and_new_payout(postgres):
    seller, _, order = await seed(postgres)
    # Give this agent separate legitimate income, so balance alone would permit payout.
    async with postgres() as session:
        async with session.begin():
            await move_account(session, seller.id, "opening-test", "commission", Decimal("10"))
    with pytest.raises(APIError):
        await accept_payment_notice(notice(order, "refunded"), postgres)
    async with postgres() as session:
        async with session.begin():
            await session.execute(
                update(Order).where(Order.id == order.id).values(payment_status="paid")
            )
    with pytest.raises(APIError) as error:
        await process_order_commission(str(order.id), postgres)
    assert error.value.code == "REFUND_REVIEW_REQUIRED"
    payout = await account(postgres, seller.id)
    with pytest.raises(APIError) as error:
        await request_withdrawal(
            seller.id, "agent", Decimal("1"), payout.id, "blocked-refund-2", postgres
        )
    assert error.value.code == "REFUND_REVIEW_REQUIRED"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["agent", "admin"])
async def test_logout_cannot_upgrade_an_inflight_ticket_request(postgres, monkeypatch, role):
    async with postgres() as session:
        async with session.begin():
            user = User(role=UserRole(role), referral_code="session-" + uuid.uuid4().hex)
            session.add(user)
            await session.flush()
            user_id = user.id
    validated, proceed = asyncio.Event(), asyncio.Event()
    original = auth.create_ticket

    async def pause(request, identity):
        validated.set()
        await proceed.wait()
        return await original(request, identity)

    monkeypatch.setattr(auth, "create_ticket", pause)
    app = create_app(SETTINGS, session_factory=postgres)
    headers = {"Authorization": "Bearer " + token(user_id, role)}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pending = asyncio.create_task(
            client.post(
                "/api/auth/web-ticket" if role == "agent" else "/api/auth/admin/web-ticket",
                headers=headers,
            )
        )
        try:
            await asyncio.wait_for(validated.wait(), 3)
            assert (
                await client.post(
                    "/api/agent/logout" if role == "agent" else "/api/auth/admin/logout",
                    headers=headers,
                )
            ).status_code == 200
        finally:
            proceed.set()
        result = await pending
        assert result.status_code == 401 and result.json()["code"] == "SESSION_REVOKED"


@pytest.mark.asyncio
async def test_reconciliation_detects_extra_commission_to_wrong_account(postgres):
    seller, _, order = await seed(postgres)
    outsider, _, _ = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    assert await reconcile(postgres) == []
    async with postgres() as session:
        async with session.begin():
            await move_account(session, outsider.id, str(order.id), "commission", Decimal("10"))
    issues = await reconcile(postgres)
    assert any(
        str(order.id) in issue and str(outsider.id) in issue and "unexpected commission" in issue
        for issue in issues
    )


@pytest.mark.asyncio
async def test_account_replacement_preserves_old_withdrawal_identity(postgres):
    seller, _, order = await seed(postgres)
    admin, _ = await admins(postgres)
    old = await save_payout_account(seller.id, "bank", "vault_original_123", "原账户", postgres)
    await decide_payout_account(old.id, admin.id, "verified-old-123", postgres)
    await accept_payment_notice(notice(order), postgres)
    withdrawal = await request_withdrawal(
        seller.id, "agent", Decimal("10"), old.id, "old-account-123", postgres
    )
    new = await save_payout_account(seller.id, "bank", "vault_replaced_123", "新账户", postgres)
    assert not new.verified and new.replaces_id == old.id
    await decide_payout_account(new.id, admin.id, "verified-new-123", postgres)
    async with postgres() as session:
        original = await session.get(PayoutAccount, withdrawal.account_id)
        assert original.id == old.id and original.status == "retired"
        assert original.account_reference == "vault_original_123"
    with pytest.raises(APIError) as error:
        await request_withdrawal(
            seller.id, "agent", Decimal("1"), old.id, "retired-account-1", postgres
        )
    assert error.value.code == "VERIFIED_PAYOUT_ACCOUNT_REQUIRED"
    rejected = await save_payout_account(
        seller.id, "bank", "vault_rejected_123", "待核验", postgres
    )
    result = await decide_payout_account(
        rejected.id, admin.id, None, postgres, rejection="归属未通过"
    )
    assert result.status == "rejected"


@pytest.mark.asyncio
async def test_withdrawal_intent_lookup_is_owner_scoped(postgres):
    seller, _, order = await seed(postgres)
    outsider, _, _ = await seed(postgres)
    await accept_payment_notice(notice(order), postgres)
    payout = await account(postgres, seller.id)
    item = await request_withdrawal(
        seller.id, "agent", Decimal("5"), payout.id, "lost-response-123", postgres
    )
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        path = "/api/agent/withdrawal-intents/lost-response-123"
        own = await client.get(path, headers={"Authorization": "Bearer " + token(seller.id)})
        assert own.status_code == 200 and own.json()["id"] == str(item.id)
        other = await client.get(path, headers={"Authorization": "Bearer " + token(outsider.id)})
        assert other.status_code == 404
