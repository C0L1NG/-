import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from ..db import get_session
from ..models import (
    PayoutAccount,
)
from ..payout_accounts import decide_payout_account, save_payout_account
from ..schemas import (
    PayoutAccountData,
    PayoutAccountPage,
    PendingAccountPage,
)
from ..security import current_admin_id, current_agent_id

router = APIRouter(tags=["financial lifecycle"])


class AccountBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["wechat", "bank"]
    # Bank identifiers are references from a secure payment vault, never raw card numbers.
    vaultReference: str | None = Field(None, pattern=r"^vault_[a-zA-Z0-9_-]{8,100}$")
    label: str = Field("收款账户", max_length=80)


def account_json(account: PayoutAccount) -> dict:
    return {
        "id": str(account.id),
        "provider": account.provider,
        "label": account.label,
        "verified": account.verified,
    }


async def save_account(body: AccountBody, owner: uuid.UUID, request: Request):
    return account_json(
        await save_payout_account(
            owner, body.provider, body.vaultReference, body.label, request.app.state.session_factory
        )
    )


@router.post("/api/agent/payout-accounts", response_model=PayoutAccountData)
async def agent_account(
    body: AccountBody, request: Request, owner: uuid.UUID = Depends(current_agent_id)
):
    return await save_account(body, owner, request)


@router.post("/api/admin/payout-accounts", response_model=PayoutAccountData)
async def admin_account(
    body: AccountBody, request: Request, owner: uuid.UUID = Depends(current_admin_id)
):
    return await save_account(body, owner, request)


@router.get("/api/agent/payout-accounts", response_model=PayoutAccountPage)
async def agent_accounts(
    owner: uuid.UUID = Depends(current_agent_id), session=Depends(get_session)
):
    return {
        "items": [
            account_json(item)
            for item in (
                await session.scalars(
                    select(PayoutAccount)
                    .where(
                        PayoutAccount.user_id == owner,
                        PayoutAccount.status.in_(["active", "pending"]),
                    )
                    .order_by(PayoutAccount.created_at)
                )
            ).all()
        ]
    }


@router.get("/api/admin/payout-accounts", response_model=PayoutAccountPage)
async def admin_accounts(
    owner: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    return {
        "items": [
            account_json(item)
            for item in (
                await session.scalars(
                    select(PayoutAccount)
                    .where(
                        PayoutAccount.user_id == owner,
                        PayoutAccount.status.in_(["active", "pending"]),
                    )
                    .order_by(PayoutAccount.created_at)
                )
            ).all()
        ]
    }


class VerificationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verificationReference: str = Field(min_length=8, max_length=128)


@router.post("/api/admin/payout-accounts/{account_id}/verify", response_model=PayoutAccountData)
async def verify_account(
    account_id: uuid.UUID,
    body: VerificationBody,
    request: Request,
    admin: uuid.UUID = Depends(current_admin_id),
):
    return account_json(
        await decide_payout_account(
            account_id, admin, body.verificationReference, request.app.state.session_factory
        )
    )


class AccountRejectionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=256)


@router.post("/api/admin/payout-accounts/{account_id}/reject", response_model=PayoutAccountData)
async def reject_account(
    account_id: uuid.UUID,
    body: AccountRejectionBody,
    request: Request,
    admin: uuid.UUID = Depends(current_admin_id),
):
    return account_json(
        await decide_payout_account(
            account_id, admin, None, request.app.state.session_factory, rejection=body.reason
        )
    )


@router.get("/api/admin/payout-accounts/pending", response_model=PendingAccountPage)
async def pending_accounts(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    condition = PayoutAccount.status == "pending"
    total = await session.scalar(select(func.count()).select_from(PayoutAccount).where(condition))
    items = (
        await session.scalars(
            select(PayoutAccount)
            .where(condition)
            .order_by(PayoutAccount.created_at, PayoutAccount.id)
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [
            {
                **account_json(item),
                "userId": str(item.user_id),
                "accountReference": item.account_reference,
            }
            for item in items
        ],
        "page": page,
        "pageSize": pageSize,
        "total": total,
    }
