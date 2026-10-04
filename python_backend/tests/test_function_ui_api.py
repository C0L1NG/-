"""Read model regressions for team isolation, date filters and financial work queues."""

import csv
import io
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import update
from test_financial_lifecycle import SETTINGS, accept, notice, seed, token
from test_second_review_regressions import payout

from app.factory import create_app
from app.models import PaymentInbox, User, UserRole
from app.withdrawals import review_withdrawal


@pytest.mark.asyncio
async def test_team_search_keeps_owner_filter_and_literal_search(postgres):
    child, parent, _ = await seed(postgres, True)
    outsider, _, _ = await seed(postgres)
    async with postgres() as session:
        async with session.begin():
            await session.execute(
                update(User).where(User.id == child.id).values(display_name="伙伴_100%")
            )
            await session.execute(
                update(User).where(User.id == outsider.id).values(display_name="伙伴_100%")
            )
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = {"Authorization": "Bearer " + token(parent.id)}
        result = await client.get(
            "/api/agent/team", params={"q": "_100%", "pageSize": 1}, headers=headers
        )
        assert result.status_code == 200
        assert result.json()["total"] == 1 and result.json()["items"][0]["id"] == str(child.id)
        second = await client.get(
            "/api/agent/team",
            params={"q": "伙伴"},
            headers={"Authorization": "Bearer " + token(child.id)},
        )
        assert second.json()["total"] == 0
        bad = await client.get(
            "/api/agent/team", params={"q": "伙伴", "agentId": str(outsider.id)}, headers=headers
        )
        assert bad.status_code == 400


@pytest.mark.asyncio
async def test_work_queue_rbac_date_summary_and_export_agree(postgres):
    seller, _, order = await seed(postgres)
    await accept(postgres, notice(order))
    pending = await payout(postgres, seller, "10.00")
    processing = await payout(postgres, seller, "15.00")
    async with postgres() as session:
        async with session.begin():
            admin = User(role=UserRole.ADMIN, referral_code="UI-ADMIN")
            session.add(admin)
            await session.flush()
            event = PaymentInbox(
                provider="ui-test",
                event_id="failed-event",
                payload_hash="f" * 64,
                payload={"orderId": str(order.id), "type": "paid"},
                status="failed",
                attempts=2,
            )
            session.add(event)
    today = datetime.now(timezone.utc).date()
    tomorrow = today + timedelta(days=1)
    await review_withdrawal(processing.id, admin.id, "start", None, postgres)
    app = create_app(SETTINGS, session_factory=postgres)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        boss = {"Authorization": "Bearer " + token(admin.id, "admin")}
        agent = {"Authorization": "Bearer " + token(seller.id)}
        summary = await client.get("/api/admin/operations-summary", headers=boss)
        assert summary.status_code == 200
        assert (
            summary.json()["pendingWithdrawals"] == 1
            and summary.json()["processingWithdrawals"] == 1
            and summary.json()["failedPaymentEvents"] == 1
        )
        assert (await client.get("/api/admin/operations-summary", headers=agent)).status_code == 401
        forged_role = {"Authorization": "Bearer " + token(seller.id, "admin")}
        assert (
            await client.get("/api/admin/operations-summary", headers=forged_role)
        ).status_code == 403
        only_pending = await client.get(
            "/api/admin/withdrawals", params={"status": "pending"}, headers=boss
        )
        assert only_pending.json()["total"] == 1 and only_pending.json()["items"][0]["id"] == str(
            pending.id
        )
        events = await client.get(
            "/api/admin/payment-events", params={"status": "failed"}, headers=boss
        )
        assert events.json()["total"] == 1
        params = {"from": today.isoformat(), "to": tomorrow.isoformat(), "q": order.order_no}
        audit = await client.get("/api/admin/commission-audit", params=params, headers=boss)
        export = await client.get("/api/admin/commission-export", params=params, headers=boss)
        assert audit.status_code == export.status_code == 200 and audit.json()["total"] == 1
        rows = list(csv.reader(io.StringIO(export.text.lstrip("\ufeff"))))
        assert len(rows) == 2 and rows[1][0] == order.order_no
        empty = await client.get(
            "/api/admin/commission-audit",
            params={"from": tomorrow.isoformat(), "to": (tomorrow + timedelta(days=1)).isoformat()},
            headers=boss,
        )
        assert empty.json()["total"] == 0
        income = await client.get(
            "/api/agent/activity-summary",
            params={"from": today.isoformat(), "to": tomorrow.isoformat()},
            headers=agent,
        )
        assert income.status_code == 200 and income.json()["netEarnings"] == "70.00"
        invalid = await client.get(
            "/api/admin/commission-export",
            params={"from": tomorrow.isoformat(), "to": today.isoformat()},
            headers=boss,
        )
        assert invalid.status_code == 400
