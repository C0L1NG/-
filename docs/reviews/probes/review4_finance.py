import asyncio
import hashlib
import hmac
import json
import time
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import select

from postgres_support import disposable_postgres
from test_financial_lifecycle import SETTINGS, account, notice, seed, token
from test_second_review_regressions import admins
from app.factory import create_app
from app.models import PaymentInbox, Wallet, WalletMovement
from app.payments import accept_payment_notice
from app.reconciliation import reconcile
from app.wallets import move_account


async def signed_post(client, value):
    raw = value.model_dump_json().encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(
        SETTINGS.payment_webhook_secret.encode(),
        timestamp.encode() + b"." + raw,
        hashlib.sha256,
    ).hexdigest()
    return await client.post(
        "/api/payments/webhook",
        content=raw,
        headers={
            "X-Payment-Timestamp": timestamp,
            "X-Payment-Signature": signature,
        },
    )


async def refund_before_payment():
    async with disposable_postgres() as factory:
        seller, _, order = await seed(factory)
        owner, _ = await admins(factory)
        payout = await account(factory, seller.id)
        app = create_app(SETTINGS, session_factory=factory)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            refund_notice = notice(order, "refunded")
            first = await signed_post(client, refund_notice)
            paid = await signed_post(client, notice(order))
            async with factory() as session:
                inbox = await session.scalar(
                    select(PaymentInbox).where(
                        PaymentInbox.event_id == refund_notice.eventId
                    )
                )
                wallet = await session.scalar(
                    select(Wallet).where(Wallet.user_id == seller.id)
                )
                interval_state = {
                    "refundInboxStatus": inbox.status,
                    "refundLastError": inbox.last_error,
                    "balance": str(wallet.balance),
                    "debt": str(wallet.debt_balance),
                }
                inbox_id = str(inbox.id)
            request = await client.post(
                "/api/agent/withdrawals",
                headers={"Authorization": "Bearer " + token(seller.id)},
                json={
                    "amount": "70.00",
                    "accountId": str(payout.id),
                    "idempotencyKey": "review4-refund-before-payment",
                },
            )
            wid = request.json()["id"]
            auth = {"Authorization": "Bearer " + token(owner.id, "admin")}
            start = await client.post(
                "/api/admin/withdrawals/" + wid + "/review",
                headers=auth,
                json={
                    "action": "start",
                    "expectedVersion": 0,
                },
            )
            confirm = await client.post(
                "/api/admin/withdrawals/" + wid + "/review",
                headers=auth,
                json={
                    "action": "confirm",
                    "transferReference": "review4-simulated-channel-receipt",
                    "expectedVersion": 1,
                },
            )
            retried = await client.post(
                "/api/admin/payment-events/" + inbox_id + "/retry", headers=auth
            )
            async with factory() as session:
                wallet = await session.scalar(
                    select(Wallet).where(Wallet.user_id == seller.id)
                )
                final_state = {
                    "balance": str(wallet.balance),
                    "frozen": str(wallet.frozen_balance),
                    "totalEarned": str(wallet.total_earned),
                    "debt": str(wallet.debt_balance),
                }
            result = {
                "refundFirst": {"http": first.status_code, "body": first.json()},
                "paymentSecond": {"http": paid.status_code, "body": paid.json()},
                "beforeRetry": interval_state,
                "withdrawalRequest": {
                    "http": request.status_code,
                    "status": request.json().get("status"),
                },
                "withdrawalStart": {
                    "http": start.status_code,
                    "status": start.json().get("status"),
                },
                "withdrawalConfirm": {
                    "http": confirm.status_code,
                    "status": confirm.json().get("status"),
                },
                "refundRetry": {"http": retried.status_code, "body": retried.json()},
                "finalWallet": final_state,
                "reconciliation": await reconcile(factory),
                "note": "Disposable DB. Transfer receipt is simulated; no real channel payment made.",
            }
            assert first.status_code == 409 and paid.status_code == 200
            assert (
                start.status_code == confirm.status_code == retried.status_code == 200
            )
            assert final_state["debt"] == "70.00"
            return result


async def phantom_commission():
    async with disposable_postgres() as factory:
        seller, _, order = await seed(factory)
        outsider, _, _ = await seed(factory)
        await accept_payment_notice(notice(order), factory)
        before = await reconcile(factory)
        # Fault injection via normal wallet service; no append-only triggers disabled.
        async with factory() as session:
            async with session.begin():
                await move_account(
                    session, outsider.id, str(order.id), "commission", Decimal("10.00")
                )
        after = await reconcile(factory)
        async with factory() as session:
            movements = (
                await session.scalars(
                    select(WalletMovement).where(
                        WalletMovement.business_id == str(order.id),
                        WalletMovement.kind == "commission",
                    )
                )
            ).all()
            wallet = await session.scalar(
                select(Wallet).where(Wallet.user_id == outsider.id)
            )
            result = {
                "profitAmount": str(order.profit_amount),
                "sumOfCommissionMovements": str(
                    sum((m.amount for m in movements), Decimal(0))
                ),
                "outsiderBalance": str(wallet.balance),
                "outsiderTotalEarned": str(wallet.total_earned),
                "reconciliationBefore": before,
                "reconciliationAfter": after,
                "note": "Intentional isolated service-level fault injection, not a demonstrated public API exploit.",
            }
            assert result["sumOfCommissionMovements"] == "110.00" and after == []
            return result


async def main():
    evidence = {
        "refund_before_payment": await refund_before_payment(),
        "phantom_commission_not_detected": await phantom_commission(),
    }
    path = Path("/tmp/review4-finance-evidence.json")
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    print(path.read_text())


asyncio.run(main())
