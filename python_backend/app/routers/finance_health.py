import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, text

from ..commission import money
from ..db import get_session
from ..errors import APIError
from ..models import (
    PlatformWallet,
    Wallet,
)
from ..schemas import (
    WalletState,
)
from ..security import current_admin_id, current_agent_id

router = APIRouter(tags=["financial lifecycle"])


@router.get("/api/admin/wallet", response_model=WalletState)
async def platform_account(
    response: Response, _admin: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    response.headers["X-Account-ID"] = str(_admin)
    account = await session.get(PlatformWallet, "platform")
    if not account:
        raise APIError(409, "WALLET_NOT_FOUND")
    return {
        "balance": money(account.balance),
        "frozenBalance": money(account.frozen_balance),
        "debtBalance": money(account.debt_balance),
        "totalEarned": money(account.total_earned),
    }


@router.get("/api/agent/wallet", response_model=WalletState)
async def agent_wallet(
    response: Response, owner: uuid.UUID = Depends(current_agent_id), session=Depends(get_session)
):
    response.headers["X-Account-ID"] = str(owner)
    account = await session.scalar(select(Wallet).where(Wallet.user_id == owner))
    if not account:
        raise APIError(409, "WALLET_NOT_FOUND")
    return {
        "balance": money(account.balance),
        "frozenBalance": money(account.frozen_balance),
        "debtBalance": money(account.debt_balance),
        "totalEarned": money(account.total_earned),
    }


@router.get("/health/live", include_in_schema=False)
async def live():
    return {"ok": True}


@router.get("/health/ready", include_in_schema=False)
async def ready(request: Request):
    try:
        async with request.app.state.session_factory() as session:
            if (
                await session.scalar(text("SELECT 1 FROM platform_wallets WHERE id='platform'"))
                != 1
            ):
                raise APIError(503, "PLATFORM_WALLET_NOT_READY")
            await session.execute(
                text("SELECT status,attempts,next_attempt_at FROM payment_inbox LIMIT 0")
            )
            await session.execute(
                text(
                    "SELECT claimed_by,version,rejection_reason,failure_reference FROM withdrawals LIMIT 0"
                )
            )
            await session.execute(text("SELECT refund_pending FROM orders LIMIT 0"))
            from ..migrations import HEAD

            if await session.scalar(text("SELECT version_num FROM alembic_version")) != HEAD:
                raise APIError(503, "MIGRATION_REQUIRED")
    except Exception as exc:
        raise APIError(503, "DATABASE_NOT_READY") from exc
    return {"ok": True}
