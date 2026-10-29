import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from ..db import get_session
from ..models import (
    PaymentInbox,
    PayoutAccount,
    Withdrawal,
)
from ..payments import (
    process_payment_inbox,
)
from ..presentation import iso_utc
from ..schemas import (
    CommissionResult,
    OperationsSummary,
    PaymentInboxPage,
)
from ..security import current_admin_id

router = APIRouter(tags=["financial lifecycle"])


@router.get("/api/admin/payment-events", response_model=PaymentInboxPage)
async def payment_events(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    status: Literal["pending", "failed", "processed"] | None = None,
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    filters = [PaymentInbox.status == status] if status else []
    total = await session.scalar(select(func.count()).select_from(PaymentInbox).where(*filters))
    items = (
        await session.scalars(
            select(PaymentInbox)
            .where(*filters)
            .order_by(PaymentInbox.created_at.desc(), PaymentInbox.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "items": [
            {
                "id": str(item.id),
                "provider": item.provider,
                "eventId": item.event_id,
                "orderId": item.payload["orderId"],
                "eventType": item.payload["type"],
                "status": item.status,
                "attempts": item.attempts,
                "lastError": item.last_error,
                "nextAttemptAt": iso_utc(item.next_attempt_at),
                "createdAt": iso_utc(item.created_at),
            }
            for item in items
        ],
    }


@router.get("/api/admin/operations-summary", response_model=OperationsSummary)
async def operations_summary(
    _admin: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    withdrawal_counts = dict(
        (
            await session.execute(
                select(Withdrawal.status, func.count()).group_by(Withdrawal.status)
            )
        ).all()
    )
    payment_counts = dict(
        (
            await session.execute(
                select(PaymentInbox.status, func.count()).group_by(PaymentInbox.status)
            )
        ).all()
    )
    unverified = await session.scalar(
        select(func.count()).select_from(PayoutAccount).where(PayoutAccount.verified.is_(False))
    )
    return {
        "pendingWithdrawals": withdrawal_counts.get("pending", 0),
        "processingWithdrawals": withdrawal_counts.get("processing", 0),
        "failedPaymentEvents": payment_counts.get("failed", 0),
        "pendingPaymentEvents": payment_counts.get("pending", 0),
        "unverifiedAccounts": unverified or 0,
    }


@router.post(
    "/api/admin/payment-events/{event_id}/retry",
    response_model=CommissionResult,
    response_model_exclude_unset=True,
)
async def retry_payment_event(
    event_id: uuid.UUID, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    return await process_payment_inbox(event_id, request.app.state.session_factory)
