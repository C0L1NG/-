import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from ..commission import money
from ..db import get_session
from ..errors import APIError
from ..models import (
    PayoutAccount,
    PlatformWallet,
    User,
    Wallet,
    Withdrawal,
    WithdrawalAction,
)
from ..presentation import iso_utc
from ..schemas import (
    PayoutDetails,
    WithdrawalData,
    WithdrawalPage,
)
from ..security import current_admin_id, current_agent_id
from ..withdrawals import has_pending_refund, request_withdrawal, review_withdrawal

router = APIRouter(tags=["financial lifecycle"])


class WithdrawalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    accountId: uuid.UUID
    idempotencyKey: str = Field(min_length=8, max_length=80)


def withdrawal_json(item: Withdrawal, display_name: str | None = None):
    return {
        "id": str(item.id),
        "amount": money(item.amount),
        "status": item.status,
        "userId": str(item.user_id),
        "userName": display_name,
        "accountScope": item.account_scope,
        "createdAt": iso_utc(item.created_at),
        "payoutReference": item.payout_reference,
        "claimedBy": str(item.claimed_by) if item.claimed_by else None,
        "version": item.version,
        "rejectionReason": item.rejection_reason,
        "failureReference": item.failure_reference,
    }


@router.post("/api/agent/withdrawals", status_code=201, response_model=WithdrawalData)
async def agent_withdrawal(
    body: WithdrawalBody, request: Request, owner: uuid.UUID = Depends(current_agent_id)
):
    return withdrawal_json(
        await request_withdrawal(
            owner,
            "agent",
            body.amount,
            body.accountId,
            body.idempotencyKey,
            request.app.state.session_factory,
        )
    )


@router.post("/api/admin/withdrawals", status_code=201, response_model=WithdrawalData)
async def platform_withdrawal(
    body: WithdrawalBody, request: Request, owner: uuid.UUID = Depends(current_admin_id)
):
    return withdrawal_json(
        await request_withdrawal(
            owner,
            "platform",
            body.amount,
            body.accountId,
            body.idempotencyKey,
            request.app.state.session_factory,
        )
    )


@router.get("/api/agent/withdrawals", response_model=WithdrawalPage)
async def own_withdrawals(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    owner: uuid.UUID = Depends(current_agent_id),
    session=Depends(get_session),
):
    total = await session.scalar(
        select(func.count()).select_from(Withdrawal).where(Withdrawal.user_id == owner)
    )
    items = (
        await session.scalars(
            select(Withdrawal)
            .where(Withdrawal.user_id == owner)
            .order_by(Withdrawal.created_at.desc(), Withdrawal.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [withdrawal_json(item) for item in items],
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


async def lookup_withdrawal_intent(owner, scope, key, session):
    item = await session.scalar(
        select(Withdrawal).where(
            Withdrawal.user_id == owner,
            Withdrawal.account_scope == scope,
            Withdrawal.idempotency_key == key,
        )
    )
    if item is None:
        raise APIError(404, "WITHDRAWAL_INTENT_NOT_FOUND")
    return withdrawal_json(item)


@router.get("/api/agent/withdrawal-intents/{key}", response_model=WithdrawalData)
async def agent_withdrawal_intent(
    key: str, owner: uuid.UUID = Depends(current_agent_id), session=Depends(get_session)
):
    return await lookup_withdrawal_intent(owner, "agent", key, session)


@router.get("/api/admin/withdrawal-intents/{key}", response_model=WithdrawalData)
async def admin_withdrawal_intent(
    key: str, owner: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    return await lookup_withdrawal_intent(owner, "platform", key, session)


@router.get("/api/admin/withdrawals", response_model=WithdrawalPage)
async def all_withdrawals(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    status: Literal["pending", "processing", "paid", "rejected"] | None = None,
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    filters = [Withdrawal.status == status] if status else []
    total = await session.scalar(select(func.count()).select_from(Withdrawal).where(*filters))
    items = (
        await session.execute(
            select(Withdrawal, User.display_name)
            .join(User, User.id == Withdrawal.user_id)
            .where(*filters)
            .order_by(Withdrawal.created_at.desc(), Withdrawal.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [withdrawal_json(item, name or "未命名账户") for item, name in items],
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["start", "confirm", "reject"]
    transferReference: str | None = Field(None, min_length=8, max_length=128)
    rejectionReason: str | None = Field(None, min_length=1, max_length=256)
    failureReference: str | None = Field(None, min_length=8, max_length=128)
    expectedVersion: int | None = Field(None, ge=0)


@router.post("/api/admin/withdrawals/{withdrawal_id}/review", response_model=WithdrawalData)
async def withdrawal_review(
    withdrawal_id: uuid.UUID,
    body: ReviewBody,
    request: Request,
    admin: uuid.UUID = Depends(current_admin_id),
):
    return withdrawal_json(
        await review_withdrawal(
            withdrawal_id,
            admin,
            body.action,
            body.transferReference,
            request.app.state.session_factory,
            reason=body.rejectionReason,
            failure_reference=body.failureReference,
            expected_version=body.expectedVersion,
        )
    )


@router.get("/api/admin/withdrawals/{withdrawal_id}/payout-details", response_model=PayoutDetails)
async def payout_details(
    withdrawal_id: uuid.UUID,
    admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    item = await session.get(Withdrawal, withdrawal_id)
    if not item:
        raise APIError(404, "WITHDRAWAL_NOT_FOUND")
    account = await session.get(PayoutAccount, item.account_id)
    if not account or account.user_id != item.user_id:
        raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
    owner = await session.get(User, item.user_id)
    claimant = await session.get(User, item.claimed_by) if item.claimed_by else None
    wallet = (
        await session.scalar(select(Wallet).where(Wallet.user_id == item.user_id))
        if item.account_scope == "agent"
        else await session.get(PlatformWallet, "platform")
    )
    if wallet is None:
        raise APIError(409, "WALLET_NOT_FOUND")
    history = (
        await session.execute(
            select(WithdrawalAction, User.display_name)
            .join(User, User.id == WithdrawalAction.actor_id)
            .where(WithdrawalAction.withdrawal_id == item.id)
            .order_by(WithdrawalAction.version)
        )
    ).all()
    return {
        "ownerName": owner.display_name or "未命名账户",
        "claimedBy": str(item.claimed_by) if item.claimed_by else None,
        "claimantName": (claimant.display_name or "管理员") if claimant else None,
        "canReview": item.status == "pending" or item.claimed_by == admin,
        "version": item.version,
        "debtBalance": money(wallet.debt_balance),
        "frozenBalance": money(wallet.frozen_balance),
        "payoutBlocked": wallet.debt_balance > 0
        or wallet.frozen_balance < item.amount
        or await has_pending_refund(session, item.user_id, item.account_scope),
        "history": [
            {
                "actorId": str(entry.actor_id),
                "actorName": name or "管理员",
                "action": entry.action,
                "fromStatus": entry.from_status,
                "toStatus": entry.to_status,
                "version": entry.version,
                "reference": entry.reference,
                "reason": entry.reason,
                "createdAt": iso_utc(entry.created_at),
            }
            for entry, name in history
        ],
        "withdrawalId": str(item.id),
        "amount": money(item.amount),
        "provider": account.provider,
        "accountReference": account.account_reference,
        "accountLabel": account.label,
        "verified": account.verified,
        "status": item.status,
    }
