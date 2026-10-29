import asyncio
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select, text
from test_financial_lifecycle import SETTINGS, notice, seed, token
from test_second_review_regressions import admins

from app.db import make_session_factory
from app.errors import APIError
from app.factory import create_app
from app.models import Order, PaymentInbox, Wallet
from app.payments import accept_payment_notice, retry_payment_inbox
from app.schema_inventory import differences, schema_inventory


@pytest.mark.asyncio
@pytest.mark.parametrize("pool_size", [1, 2, 5])
async def test_http_writes_release_auth_connection(postgres, pool_size):
    seller, _, order = await seed(postgres)
    async with postgres() as session:
        schema = await session.scalar(text("SELECT current_schema()"))
    import os

    from sqlalchemy.engine import make_url

    url = make_url(os.environ["TEST_DATABASE_URL"]).set(
        query={
            "schema": schema,
            "connection_limit": str(pool_size),
            "pool_timeout": "1",
        }
    )
    factory, engine = make_session_factory(url.render_as_string(hide_password=False))
    try:
        app = create_app(SETTINGS, session_factory=factory)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            responses = await asyncio.gather(
                *[
                    client.post(
                        "/api/agent/payout-accounts",
                        json={"provider": "wechat"},
                        headers={"Authorization": "Bearer " + token(seller.id)},
                    )
                    for _ in range(pool_size + 2)
                ]
            )
            assert all(response.status_code == 200 for response in responses)
            assert len({response.json()["id"] for response in responses}) == 1
            await accept_payment_notice(notice(order), postgres)
            headers = {"Authorization": "Bearer " + token(seller.id)}
            withdrawal = await client.post(
                "/api/agent/withdrawals",
                headers=headers,
                json={
                    "amount": "1.00",
                    "accountId": responses[0].json()["id"],
                    "idempotencyKey": "pool-test-intent",
                },
            )
            assert withdrawal.status_code == 201
            admin, _ = await admins(postgres)
            admin_headers = {"Authorization": "Bearer " + token(admin.id, "admin")}
            endpoint = "/api/admin/withdrawals/" + withdrawal.json()["id"] + "/review"
            assert (
                await client.post(endpoint, headers=admin_headers, json={"action": "start"})
            ).status_code == 200
            assert (
                await client.post(
                    endpoint,
                    headers=admin_headers,
                    json={"action": "confirm", "transferReference": "pool-test-receipt"},
                )
            ).status_code == 200
            assert (await client.post("/api/auth/web-ticket", headers=headers)).status_code == 200
            assert (
                await client.get("/api/admin/commission-export", headers=admin_headers)
            ).status_code == 200
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_invalid_refund_cannot_poison_valid_merge(postgres):
    seller, _, order = await seed(postgres)
    invalid = notice(order, "refunded").model_copy(update={"transactionId": "x" * 128})
    with pytest.raises(APIError, match="INVALID_PAYMENT_REFERENCE"):
        await accept_payment_notice(invalid, postgres)
    valid = notice(order, "refunded")
    with pytest.raises(APIError, match="ORDER_NOT_PAID"):
        await accept_payment_notice(valid, postgres)
    assert (await accept_payment_notice(notice(order), postgres))["status"] == "refunded"
    await accept_payment_notice(valid, postgres)
    async with postgres() as session:
        current = await session.get(Order, order.id)
        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == seller.id))
        invalid_row = await session.scalar(
            select(PaymentInbox).where(PaymentInbox.event_id == invalid.eventId)
        )
        assert current.payment_status.value == "refunded" and not current.refund_pending
        assert wallet.balance == Decimal("0.00")
        assert invalid_row.attempts == 20 and invalid_row.last_error == "INVALID_PAYMENT_REFERENCE"
    assert (await retry_payment_inbox(postgres))["attempted"] == 0


@pytest.mark.asyncio
async def test_disabled_append_only_trigger_is_schema_drift(postgres):
    async with postgres() as session:
        async with session.begin():
            before = await schema_inventory(session)
            await session.execute(
                text("ALTER TABLE wallet_movements DISABLE TRIGGER wallet_movements_append_only")
            )
            after = await schema_inventory(session)
            assert differences(before, after) == ["triggers"]
            await session.execute(
                text("ALTER TABLE wallet_movements ENABLE TRIGGER wallet_movements_append_only")
            )
            assert differences(before, await schema_inventory(session)) == []
            assert all(row["valid"] and row["ready"] for row in before["indexes"])
