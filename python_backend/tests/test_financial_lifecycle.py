import asyncio
import hashlib
import hmac
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import jwt
import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.binding import bind_direct_parent
from app.config import Settings
from app.errors import APIError
from app.exports import stream_audit_csv
from app.factory import create_app
from app.models import (
    Base,
    CommissionLog,
    Order,
    PaymentEvent,
    PaymentStatus,
    PayoutAccount,
    PlatformWallet,
    Refund,
    SettlementStatus,
    User,
    UserRole,
    Wallet,
    WalletMovement,
)
from app.payments import PaymentNotice, accept_payment_notice
from app.queries.admin_metrics import overview_totals
from app.queries.admin_network import network_page
from app.queries.agent_metrics import progress_summary, today_estimate
from app.reconciliation import reconcile
from app.security import hash_password
from app.wechat import WechatSession
from app.withdrawals import request_withdrawal, review_withdrawal

SETTINGS = Settings(
    "postgresql://u:p@localhost/commission_test",
    "x" * 32,
    "saas",
    "agent-portal",
    "admin-portal",
    "https://example.com/register",
    payment_webhook_secret="s" * 32,
    secure_cookies=False,
)


def token(user_id, role="agent", version=0):
    return jwt.encode(
        {
            "sub": str(user_id),
            "iss": "saas",
            "aud": f"{role}-portal",
            "ver": version,
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        SETTINGS.jwt_secret,
        algorithm="HS256",
    )


def notice(order, event="paid", key=None):
    return PaymentNotice(
        provider="test",
        eventId=key or uuid.uuid4().hex,
        orderId=order.id,
        type=event,
        transactionId=("refund-" if event == "refunded" else "pay-") + str(order.id),
        amount=order.total_amount,
    )


async def accept(factory, value):
    return await accept_payment_notice(value, factory)


async def seed(factory, has_parent=False, profit="100.00", wallet=True):
    async with factory() as session:
        async with session.begin():
            parent = User(referral_code="ROOT-" + uuid.uuid4().hex[:10]) if has_parent else None
            if parent:
                session.add(parent)
                await session.flush()
                if wallet:
                    session.add(Wallet(user_id=parent.id))
            seller = User(
                referral_code="SELL-" + uuid.uuid4().hex[:10],
                parent_id=parent.id if parent else None,
                wechat_open_id="wx-" + uuid.uuid4().hex,
            )
            session.add(seller)
            await session.flush()
            session.add(Wallet(user_id=seller.id))
            order = Order(
                order_no="TEST-" + uuid.uuid4().hex,
                customer_id="customer",
                promoter_id=seller.id,
                total_amount=Decimal("250.00"),
                profit_amount=Decimal(profit),
            )
            session.add(order)
            await session.flush()
            return seller, parent, order


@pytest.mark.asyncio
@pytest.mark.parametrize("parent", [False, True])
async def test_signed_event_atomic_settlement_and_retry(postgres, parent):
    seller, mentor, order = await seed(postgres, parent)
    value = notice(order)
    results = await asyncio.gather(accept(postgres, value), accept(postgres, value))
    assert sorted(x["status"] for x in results) == ["already_processed", "settled"]
    async with postgres() as session:
        assert await session.scalar(select(func.count()).select_from(PaymentEvent)) == 1
        final = await session.get(Order, order.id)
        assert final.paid_at and final.settled_at and final.attribution_locked_at
        assert final.attribution_parent_id == (mentor.id if mentor else None)
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert wallet.balance == Decimal("49.00" if parent else "70.00")
        assert await session.scalar(
            select(func.count())
            .select_from(WalletMovement)
            .where(WalletMovement.kind == "commission")
        ) == (3 if parent else 2)
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_event_amount_mismatch_and_identity_conflict(postgres):
    seller, _, order = await seed(postgres)
    bad = notice(order).model_copy(update={"amount": Decimal("1.00")})
    with pytest.raises(APIError) as exc:
        await accept(postgres, bad)
    assert exc.value.code == "PAYMENT_AMOUNT_MISMATCH"
    good = notice(order)
    await accept(postgres, good)
    with pytest.raises(APIError) as exc:
        await accept(postgres, good.model_copy(update={"transactionId": "changed"}))
    assert exc.value.code == "PAYMENT_EVENT_CONFLICT"
    async with postgres() as session:
        assert await session.scalar(select(func.count()).select_from(PaymentEvent)) == 1


@pytest.mark.asyncio
async def test_missing_wallet_rolls_back_payment_and_every_account(postgres):
    seller, parent, order = await seed(postgres, True, wallet=False)
    with pytest.raises(ValueError, match="Wallet"):
        await accept(postgres, notice(order))
    async with postgres() as session:
        assert (await session.get(Order, order.id)).payment_status == PaymentStatus.PENDING
        assert (await session.get(PlatformWallet, "platform")).balance == 0
        assert (
            await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        ).balance == 0
        for model in [PaymentEvent, CommissionLog]:
            assert await session.scalar(select(func.count()).select_from(model)) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(WalletMovement)
                .where(WalletMovement.kind == "commission")
            )
            == 0
        )


@pytest.mark.asyncio
async def test_order_keeps_creation_attribution_after_first_binding(postgres):
    seller, _, order = await seed(postgres)
    async with postgres() as session:
        async with session.begin():
            parent = User(referral_code="NEW-ROOT")
            session.add(parent)
            await session.flush()
            session.add(Wallet(user_id=parent.id))
    await bind_direct_parent(seller.id, "NEW-ROOT", postgres)
    await accept(postgres, notice(order))
    async with postgres() as session:
        final = await session.get(Order, order.id)
        assert final.attribution_parent_id is None
        assert (
            await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        ).balance == Decimal("70.00")
        assert (
            await session.scalar(select(Wallet).where(Wallet.user_id == parent.id))
        ).balance == 0
        with pytest.raises(DBAPIError):
            await session.execute(
                update(Order).where(Order.id == order.id).values(attribution_parent_id=parent.id)
            )


async def account(factory, user_id):
    async with factory() as session:
        async with session.begin():
            result = PayoutAccount(
                user_id=user_id,
                provider="wechat",
                account_reference="wx-account",
                label="本人微信零钱",
                verified=True,
            )
            session.add(result)
            await session.flush()
            return result


@pytest.mark.asyncio
async def test_concurrent_withdrawal_holds_once_and_failure_releases(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    payout = await account(postgres, seller.id)
    a, b = await asyncio.gather(
        *[
            request_withdrawal(
                seller.id, "agent", Decimal("50.00"), payout.id, "same-key-123", postgres
            )
            for _ in range(2)
        ]
    )
    assert a.id == b.id
    with pytest.raises(APIError) as exc:
        await request_withdrawal(
            seller.id, "agent", Decimal("51.00"), payout.id, "same-key-123", postgres
        )
    assert exc.value.code == "IDEMPOTENCY_CONFLICT"
    await review_withdrawal(a.id, seller.id, "start", None, postgres)
    with pytest.raises(APIError):
        await review_withdrawal(a.id, seller.id, "reject", None, postgres)
    await review_withdrawal(a.id, seller.id, "reject", "channel-failed-123", postgres)
    await review_withdrawal(a.id, seller.id, "reject", "channel-failed-123", postgres)
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert (wallet.balance, wallet.frozen_balance) == (Decimal("70.00"), Decimal("0.00"))
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_paid_withdrawal_refund_debt_and_future_repayment(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    payout = await account(postgres, seller.id)
    item = await request_withdrawal(
        seller.id, "agent", Decimal("70.00"), payout.id, "paid-key-123", postgres
    )
    await review_withdrawal(item.id, seller.id, "start", None, postgres)
    await review_withdrawal(item.id, seller.id, "confirm", "channel-success-123", postgres)
    refund = notice(order, "refunded")
    await accept(postgres, refund)
    await accept(postgres, refund)
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert (wallet.balance, wallet.total_earned, wallet.debt_balance) == (
            Decimal("0"),
            Decimal("0"),
            Decimal("70"),
        )
        assert (await session.get(Order, order.id)).settlement_status == SettlementStatus.REVERSED
        assert await session.scalar(select(func.count()).select_from(Refund)) == 1
        async with session.begin_nested():
            second = Order(
                order_no="NEXT",
                customer_id="c",
                promoter_id=seller.id,
                total_amount=Decimal("250"),
                profit_amount=Decimal("100"),
            )
            session.add(second)
            await session.flush()
        await session.commit()
    await accept(postgres, notice(second))
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert (wallet.balance, wallet.debt_balance, wallet.total_earned) == (
            Decimal("0"),
            Decimal("0"),
            Decimal("70"),
        )
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_refund_while_frozen_then_reject_reclaims_debt(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    payout = await account(postgres, seller.id)
    item = await request_withdrawal(
        seller.id, "agent", Decimal("70"), payout.id, "frozen-key-123", postgres
    )
    await accept(postgres, notice(order, "refunded"))
    await review_withdrawal(item.id, seller.id, "reject", "refund-cancelled-123", postgres)
    async with postgres() as session:
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        assert (
            wallet.balance,
            wallet.frozen_balance,
            wallet.debt_balance,
            wallet.total_earned,
        ) == (Decimal(0),) * 4
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_metrics_survive_settlement_then_account_for_refund(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    async with postgres() as session:
        assert await today_estimate(session, seller.id) == Decimal("70")
        summary = await progress_summary(session, seller.id)
        assert summary["monthEarned"] == "70.00"
        totals = await overview_totals(session, "all")
        assert totals["platformTotalRevenue"] == "30.00" and totals["totalGmv"] == "250.00"
    await accept(postgres, notice(order, "refunded"))
    async with postgres() as session:
        assert await today_estimate(session, seller.id) == Decimal(0)
        assert (await progress_summary(session, seller.id))["monthEarned"] == "0.00"
        totals = await overview_totals(session, "all")
        assert (
            totals["platformTotalRevenue"],
            totals["agentCommissionPool"],
            totals["totalGmv"],
        ) == ("0.00",) * 3


@pytest.mark.asyncio
async def test_ranking_covers_member_beyond_first_hundred(postgres):
    async with postgres() as session:
        async with session.begin():
            root = User(referral_code="ROOT")
            session.add(root)
            await session.flush()
            session.add(Wallet(user_id=root.id))
            children = [User(referral_code=f"CHILD-{i}", parent_id=root.id) for i in range(101)]
            session.add_all(children)
            await session.flush()
            session.add_all(Wallet(user_id=x.id) for x in children)
            order = Order(
                order_no="LEADER",
                customer_id="c",
                promoter_id=children[0].id,
                total_amount=Decimal(100),
                profit_amount=Decimal(100),
            )
            session.add(order)
            await session.flush()
    await accept(postgres, notice(order))
    async with postgres() as session:
        summary = await progress_summary(session, root.id)
        assert summary["directAgentCount"] == 101 and summary["leaders"][0]["id"] == str(
            children[0].id
        )
        roots = await network_page(session, None, 1, 20, None, "")
        assert (
            roots["items"][0]["teamSize"] == 101
            and roots["items"][0]["teamPlatformContribution"] == "30.00"
        )
        page = await network_page(session, root.id, 6, 20, None, "")
        assert len(page["items"]) == 1 and page["total"] == 101


@pytest.mark.asyncio
async def test_export_uses_stable_snapshot_during_new_orders(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    stream = stream_audit_csv(postgres, "all", "")
    header = await anext(stream)
    assert "平台原始分成" in header
    _, _, new_order = await seed(postgres)
    body = "".join([part async for part in stream])
    assert order.order_no in body and new_order.order_no not in body


@pytest.mark.asyncio
async def test_all_model_columns_exist_after_actual_migrations(postgres):
    async with postgres() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()"
                )
            )
        ).all()
        actual = {}
        for table, column in rows:
            actual.setdefault(table, set()).add(column)
        assert {
            name: set(table.columns.keys()) for name, table in Base.metadata.tables.items()
        } == actual


@pytest.mark.asyncio
async def test_web_login_ticket_single_use_admin_login_and_logout_revocation(postgres):
    seller, _, _ = await seed(postgres)
    async with postgres() as session:
        async with session.begin():
            admin = User(
                role=UserRole.ADMIN,
                login_name="owner",
                password_hash=hash_password("long-password-123"),
            )
            session.add(admin)
            await session.flush()
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer " + token(seller.id)}
        ticket = (await client.post("/api/auth/web-ticket", headers=headers)).json()["ticket"]
        login = await client.post("/api/auth/web/exchange", json={"ticket": ticket})
        assert login.status_code == 200 and "HttpOnly" in login.headers["set-cookie"]
        assert (
            await client.post(
                "/api/auth/web/exchange", headers={"Origin": "http://test"}, json={"ticket": ticket}
            )
        ).status_code == 401
        assert (await client.get("/api/admin/overview", headers=headers)).status_code == 401
        assert (await client.post("/api/admin/orders", headers=headers, json={})).status_code == 401
        await client.post("/api/agent/logout", headers=headers)
        assert (await client.get("/api/agent/overview", headers=headers)).status_code == 401
        owner = await client.post(
            "/api/auth/admin/login", json={"username": "owner", "password": "long-password-123"}
        )
        assert owner.status_code == 200
        bad = await client.post(
            "/api/auth/admin/login",
            headers={"Origin": "http://test"},
            json={"username": "owner", "password": "wrong"},
        )
        assert bad.status_code == 401
        admin_header = {"Authorization": "Bearer " + owner.json()["accessToken"]}
        assert (await client.get("/api/admin/overview", headers=admin_header)).status_code == 200
        assert (await client.get("/api/agent/overview", headers=admin_header)).status_code == 401
        assert (
            await client.get("/api/agent/payout-accounts", headers=admin_header)
        ).status_code == 401


class FakeWechat:
    async def code2session(self, code):
        return WechatSession("new-agent-id")


@pytest.mark.asyncio
async def test_invalid_invite_rolls_back_new_wechat_identity(postgres):
    app = create_app(SETTINGS, session_factory=postgres, wechat=FakeWechat())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/auth/wechat/login", json={"code": "wx-code", "referralCode": "MISSING"}
        )
        assert response.status_code == 404
    async with postgres() as session:
        assert await session.scalar(select(func.count()).select_from(User)) == 0


@pytest.mark.asyncio
async def test_webhook_rejects_forged_signature_and_accepts_verified_event(postgres):
    _, _, order = await seed(postgres)
    app = create_app(SETTINGS, session_factory=postgres)
    raw = notice(order).model_dump_json().encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(
        SETTINGS.payment_webhook_secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256
    ).hexdigest()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"X-Payment-Timestamp": timestamp, "X-Payment-Signature": "forged"}
        assert (
            await client.post("/api/payments/webhook", content=raw, headers=headers)
        ).status_code == 401
        headers["X-Payment-Signature"] = signature
        result = await client.post("/api/payments/webhook", content=raw, headers=headers)
        assert result.status_code == 200 and result.json()["status"] == "settled"
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_admin_ticket_and_verified_payout_details_remain_admin_only(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    async with postgres() as session:
        async with session.begin():
            admin = User(role=UserRole.ADMIN, login_name="owner-two")
            account = PayoutAccount(
                user_id=seller.id,
                provider="bank",
                label="本人账户",
                account_reference="vault_real_reference",
                verified=False,
            )
            session.add_all([admin, account])
            await session.flush()
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        admin_headers = {"Authorization": "Bearer " + token(admin.id, "admin")}
        agent_headers = {"Authorization": "Bearer " + token(seller.id)}
        path = f"/api/admin/payout-accounts/{account.id}/verify"
        assert (
            await client.post(
                path, headers=agent_headers, json={"verificationReference": "proof-0001"}
            )
        ).status_code == 401
        assert (
            await client.post(
                path, headers=admin_headers, json={"verificationReference": "proof-0001"}
            )
        ).status_code == 200
        response = await client.post(
            "/api/agent/withdrawals",
            headers=agent_headers,
            json={
                "amount": "10.00",
                "accountId": str(account.id),
                "idempotencyKey": "request-0001",
            },
        )
        assert response.status_code == 201
        detail = f"/api/admin/withdrawals/{response.json()['id']}/payout-details"
        assert (await client.get(detail, headers=agent_headers)).status_code == 401
        assert (await client.get(detail, headers=admin_headers)).json()[
            "accountReference"
        ] == "vault_real_reference"
        ticket = (await client.post("/api/auth/admin/web-ticket", headers=admin_headers)).json()[
            "ticket"
        ]
        login = await client.post("/api/auth/web/exchange", json={"ticket": ticket})
        assert login.status_code == 200 and login.json()["role"] == "admin"
        assert "admin_access_token=" in login.headers["set-cookie"]
        assert (await client.get("/api/admin/overview")).status_code == 200
        assert (await client.get("/api/agent/overview")).status_code == 401
        await client.post("/api/auth/admin/logout", headers=admin_headers)
        assert (
            await client.post("/api/auth/web/exchange", json={"ticket": ticket})
        ).status_code == 401
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_zero_profit_and_semantically_identical_notice_retries(postgres):
    _, _, order = await seed(postgres, has_parent=True, profit="0.00")
    original = notice(order)
    await accept(postgres, original)
    equivalent = original.model_copy(
        update={"amount": Decimal(str(order.total_amount)).normalize()}
    )
    assert (await accept(postgres, equivalent))["status"] == "already_processed"
    await accept(postgres, notice(order, "refunded"))
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_account_disable_revokes_sessions_and_unredeemed_tickets(postgres):
    seller, _, _ = await seed(postgres)
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer " + token(seller.id)}
        ticket = (await client.post("/api/auth/web-ticket", headers=headers)).json()["ticket"]
        async with postgres() as session:
            async with session.begin():
                await session.execute(
                    update(User)
                    .where(User.id == seller.id)
                    .values(is_active=False, token_version=1)
                )
        assert (await client.get("/api/agent/overview", headers=headers)).status_code == 401
        assert (
            await client.post("/api/auth/web/exchange", json={"ticket": ticket})
        ).status_code == 401


@pytest.mark.asyncio
async def test_cross_month_refund_has_matching_admin_and_network_net_metrics(postgres):
    import csv
    import io

    from app.models import CommissionRole, PlatformCommissionLog
    from app.periods import period_range
    from app.queries.agent_activity import activity_page
    from app.routers.admin import audit
    from app.wallets import move_account

    seller, parent, order = await seed(postgres, has_parent=True)
    previous = period_range("previous_month")[0] + timedelta(days=1)
    async with postgres() as session:
        async with session.begin():
            await session.execute(
                update(Order)
                .where(Order.id == order.id)
                .values(
                    payment_status=PaymentStatus.PAID,
                    settlement_status=SettlementStatus.SETTLED,
                    paid_at=previous,
                    settled_at=previous,
                )
            )
            session.add(
                PlatformCommissionLog(
                    order_id=order.id,
                    rate=Decimal("0.30"),
                    commission_amount=Decimal("30.00"),
                    created_at=previous,
                )
            )
            session.add_all(
                [
                    CommissionLog(
                        order_id=order.id,
                        recipient_id=seller.id,
                        role_type=CommissionRole.PROMOTER,
                        rate=Decimal("0.49"),
                        commission_amount=Decimal("49.00"),
                        created_at=previous,
                    ),
                    CommissionLog(
                        order_id=order.id,
                        recipient_id=parent.id,
                        role_type=CommissionRole.PARENT,
                        rate=Decimal("0.21"),
                        commission_amount=Decimal("21.00"),
                        created_at=previous,
                    ),
                ]
            )
            await move_account(session, None, str(order.id), "commission", Decimal("30.00"))
            for owner, amount in sorted(
                [(seller.id, Decimal("49.00")), (parent.id, Decimal("21.00"))],
                key=lambda pair: pair[0].hex,
            ):
                await move_account(session, owner, str(order.id), "commission", amount)
    await accept(postgres, notice(order, "refunded"))
    async with postgres() as session:
        now = await overview_totals(session, "month")
        before = await overview_totals(session, "previous_month")
        roots = await network_page(session, None, 1, 20, period_range("month"), "")
        children = await network_page(session, parent.id, 1, 20, period_range("month"), "")
        assert now["platformTotalRevenue"] == "-30.00" and before["platformTotalRevenue"] == "30.00"
        assert now["totalGmv"] == roots["items"][0]["teamGmv"] == "-250.00"
        assert roots["items"][0]["teamPlatformContribution"] == "-30.00"
        assert children["items"][0]["mentorPaidUp"] == "-21.00"
        events = await activity_page(session, seller.id, 1, 20, period_range("month"), None)
        assert events["total"] == 1
        assert events["items"][0]["entryType"] == "refund"
        assert events["items"][0]["commissionAmount"] == "-49.00"
        other = await activity_page(session, parent.id, 1, 20, period_range("month"), "PARENT")
        assert other["items"][0]["commissionAmount"] == "-21.00"
        assert other["items"][0]["id"] != events["items"][0]["id"]
        history = await activity_page(session, seller.id, 1, 20, None, None)
        assert sum(Decimal(item["commissionAmount"]) for item in history["items"]) == 0
        result = await audit(
            page=1, pageSize=20, period="month", q=None, _admin_id=parent.id, session=session
        )
        assert result["total"] == 1 and result["items"][0]["settlementStatus"] == "REVERSED"
    exported = "".join([part async for part in stream_audit_csv(postgres, "month", "")])
    row = list(csv.DictReader(io.StringIO(exported.lstrip("\ufeff"))))[0]
    assert [row[key] for key in ["当期净GMV", "当期平台净收益", "当期代理净佣金"]] == [
        "-250.00",
        "-30.00",
        "-70.00",
    ]
    assert await reconcile(postgres) == []


@pytest.mark.asyncio
async def test_activity_contract_preserves_legacy_ledger_and_prevents_owner_override(postgres):
    seller, _, order = await seed(postgres)
    outsider, _, _ = await seed(postgres)
    await accept(postgres, notice(order))
    await accept(postgres, notice(order, "refunded"))
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer " + token(seller.id)}
        activity = await client.get("/api/agent/activity", headers=headers)
        legacy = await client.get("/api/agent/ledger", headers=headers)
        assert activity.status_code == legacy.status_code == 200
        assert {item["commissionAmount"] for item in activity.json()["items"]} == {
            "70.00",
            "-70.00",
        }
        assert legacy.json()["total"] == 1 and "entryType" not in legacy.json()["items"][0]
        assert (
            await client.get("/api/agent/activity?recipientId=" + str(outsider.id), headers=headers)
        ).status_code == 400
        assert (
            await client.get("/api/agent/activity?from=2026-03-02&to=2026-03-01", headers=headers)
        ).status_code == 400
        empty = await client.get(
            "/api/agent/activity", headers={"Authorization": "Bearer " + token(outsider.id)}
        )
        assert empty.json()["items"] == []
