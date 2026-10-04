"""Verified merchant events; never treat a browser's 'paid' flag as payment."""

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .commission import settle_locked_order
from .errors import APIError
from .models import (
    CommissionLog,
    Order,
    PaymentEvent,
    PaymentInbox,
    PaymentStatus,
    PlatformCommissionLog,
    Refund,
    SettlementStatus,
)
from .wallets import move_account


class PaymentNotice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    eventId: str = Field(min_length=1, max_length=128)
    orderId: uuid.UUID
    type: Literal["paid", "refunded"]
    transactionId: str = Field(min_length=1, max_length=128)
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    currency: Literal["CNY"] = "CNY"


def verify_merchant_signature(secret: str, raw: bytes, timestamp: str, signature: str) -> None:
    if len(secret) < 32:
        raise APIError(501, "PAYMENT_CHANNEL_NOT_CONFIGURED")
    try:
        if abs(time.time() - int(timestamp)) > 300:
            raise ValueError("expired")
    except ValueError as exc:
        raise APIError(401, "INVALID_PAYMENT_SIGNATURE") from exc
    expected = hmac.new(
        secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise APIError(401, "INVALID_PAYMENT_SIGNATURE")


async def reverse_locked_order(session: AsyncSession, order: Order, reference: str) -> dict:
    if order.payment_status == PaymentStatus.REFUNDED:
        prior = await session.scalar(select(Refund).where(Refund.order_id == order.id))
        if prior is None:
            raise APIError(409, "LEGACY_REFUND_RECONCILIATION_REQUIRED")
        if prior and prior.payment_reference != reference:
            raise APIError(409, "REFUND_REFERENCE_CONFLICT")
        return {"status": "already_refunded", "orderId": str(order.id)}
    if order.payment_status != PaymentStatus.PAID:
        raise APIError(409, "ORDER_NOT_PAID")
    platform_amount = agent_amount = Decimal("0.00")
    if order.settlement_status == SettlementStatus.SETTLED:
        platform = await session.scalar(
            select(PlatformCommissionLog).where(PlatformCommissionLog.order_id == order.id)
        )
        logs = (
            await session.scalars(select(CommissionLog).where(CommissionLog.order_id == order.id))
        ).all()
        if platform is None or not logs:
            raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
        platform_amount = platform.commission_amount
        await move_account(session, None, str(order.id), "refund", platform_amount)
        for log in sorted(logs, key=lambda item: item.recipient_id.hex):
            agent_amount += log.commission_amount
            await move_account(
                session, log.recipient_id, str(order.id), "refund", log.commission_amount
            )
    elif order.settlement_status != SettlementStatus.PENDING:
        raise APIError(409, "INVALID_REFUND_STATE")
    session.add(
        Refund(
            order_id=order.id,
            payment_reference=reference,
            total_amount=order.total_amount,
            platform_amount=platform_amount,
            agent_amount=agent_amount,
        )
    )
    order.payment_status = PaymentStatus.REFUNDED
    order.settlement_status = SettlementStatus.REVERSED
    order.refunded_at = datetime.now(timezone.utc)
    order.updated_at = datetime.now(timezone.utc)
    return {"status": "refunded", "orderId": str(order.id)}


async def accept_payment_notice(notice: PaymentNotice, session_factory) -> dict:
    """Only call after signature verification (or from trusted internal code)."""
    canonical = notice.model_dump(mode="json")
    canonical["amount"] = format(notice.amount, ".2f")
    payload_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
    # Receipt commits independently. A settlement rollback must not lose merchant evidence.
    async with session_factory() as session:
        async with session.begin():
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"payment:{notice.provider}:{notice.eventId}"},
            )
            inbox = await session.scalar(
                select(PaymentInbox).where(
                    PaymentInbox.provider == notice.provider,
                    PaymentInbox.event_id == notice.eventId,
                )
            )
            if inbox:
                if inbox.payload_hash != payload_hash:
                    raise APIError(409, "PAYMENT_EVENT_CONFLICT")
            else:
                inbox = PaymentInbox(
                    provider=notice.provider,
                    event_id=notice.eventId,
                    payload_hash=payload_hash,
                    payload=canonical,
                )
                session.add(inbox)
                await session.flush()
            inbox_id = inbox.id
    return await process_payment_inbox(inbox_id, session_factory)


async def process_payment_inbox(inbox_id: uuid.UUID, session_factory, *, due_only=False) -> dict:
    failure = None
    async with session_factory() as session:
        async with session.begin():
            inbox = await session.scalar(
                select(PaymentInbox).where(PaymentInbox.id == inbox_id).with_for_update()
            )
            if inbox is None:
                raise APIError(404, "PAYMENT_INBOX_NOT_FOUND")
            notice = PaymentNotice.model_validate(inbox.payload)
            if inbox.status == "processed":
                return {"status": "already_processed", "orderId": str(notice.orderId)}
            if due_only and (
                inbox.attempts >= 20 or inbox.next_attempt_at > datetime.now(timezone.utc)
            ):
                return {"status": "deferred", "orderId": str(notice.orderId)}
            inbox.attempts += 1
            try:
                async with session.begin_nested():
                    result = await apply_payment_notice(notice, inbox.payload_hash, session)
                    await session.flush()
                inbox.status, inbox.last_error = "processed", None
                inbox.processed_at = datetime.now(timezone.utc)
            except Exception as exc:
                failure = exc
                inbox.status = "failed"
                inbox.last_error = exc.code if isinstance(exc, APIError) else type(exc).__name__
                inbox.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                    seconds=min(3600, 30 * 2 ** min(inbox.attempts - 1, 7))
                )
            await session.flush()
    if failure is not None:
        raise failure
    return result


async def apply_payment_notice(notice: PaymentNotice, payload_hash: str, session: AsyncSession):
    previous = await session.scalar(
        select(PaymentEvent).where(
            PaymentEvent.provider == notice.provider,
            PaymentEvent.event_id == notice.eventId,
        )
    )
    if previous:
        if previous.payload_hash != payload_hash:
            raise APIError(409, "PAYMENT_EVENT_CONFLICT")
        return {"status": "already_processed", "orderId": str(previous.order_id)}
    order = (
        await session.scalars(select(Order).where(Order.id == notice.orderId).with_for_update())
    ).one_or_none()
    if order is None:
        raise APIError(404, "ORDER_NOT_FOUND")
    if notice.amount != order.total_amount:
        raise APIError(
            409,
            "PAYMENT_AMOUNT_MISMATCH",
            "Only full payment/full refund events are supported",
        )
    reference = f"{notice.provider}:{notice.transactionId}"
    if len(reference) > 128:
        raise APIError(400, "INVALID_PAYMENT_REFERENCE")
    if notice.type == "paid":
        if order.payment_status == PaymentStatus.REFUNDED:
            raise APIError(409, "ORDER_ALREADY_REFUNDED")
        if order.payment_reference and order.payment_reference != reference:
            raise APIError(409, "PAYMENT_REFERENCE_CONFLICT")
        if order.payment_status not in {PaymentStatus.PENDING, PaymentStatus.PAID}:
            raise APIError(409, "INVALID_PAYMENT_STATE")
        order.payment_status = PaymentStatus.PAID
        order.payment_reference = reference
        order.paid_at = order.paid_at or datetime.now(timezone.utc)
        await session.flush()
        result = await settle_locked_order(session, order)
    else:
        result = await reverse_locked_order(session, order, reference)
    session.add(
        PaymentEvent(
            provider=notice.provider,
            event_id=notice.eventId,
            payload_hash=payload_hash,
            order_id=order.id,
            event_type=notice.type,
        )
    )
    return result


async def retry_payment_inbox(session_factory, limit=100):
    """Bounded batch. Locks serialize workers; one failing event never stops the batch."""
    if not 1 <= limit <= 1000:
        raise ValueError("limit must be between 1 and 1000")
    async with session_factory() as session:
        ids = (
            await session.scalars(
                select(PaymentInbox.id)
                .where(
                    PaymentInbox.status != "processed",
                    PaymentInbox.attempts < 20,
                    PaymentInbox.next_attempt_at <= datetime.now(timezone.utc),
                )
                .order_by(PaymentInbox.next_attempt_at, PaymentInbox.id)
                .limit(limit)
            )
        ).all()
    failures = 0
    for inbox_id in ids:
        try:
            await process_payment_inbox(inbox_id, session_factory, due_only=True)
        except Exception:
            failures += 1
    return {"attempted": len(ids), "failed": failures}
