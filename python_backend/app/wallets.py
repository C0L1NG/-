"""Locked account operations, with atomic SQL updates and immutable movements."""

import uuid
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .errors import APIError
from .models import PlatformWallet, Wallet, WalletMovement

ZERO = Decimal("0.00")


async def move_account(
    session: AsyncSession, owner: uuid.UUID | None, business_id: str, kind: str, amount: Decimal
) -> None:
    model = Wallet if owner is not None else PlatformWallet
    condition = Wallet.user_id == owner if owner is not None else PlatformWallet.id == "platform"
    account = await lock_account(session, owner)
    balance_delta = frozen_delta = earned_delta = debt_delta = ZERO
    if kind == "commission":
        repayment = min(amount, account.debt_balance)
        balance_delta, earned_delta, debt_delta = amount - repayment, amount, -repayment
    elif kind == "refund":
        debit = min(amount, account.balance)
        balance_delta, earned_delta, debt_delta = -debit, -amount, amount - debit
        if account.total_earned < amount:
            raise APIError(
                409,
                "ACCOUNT_RECONCILIATION_REQUIRED",
                "Commission history does not match wallet earnings",
            )
    elif kind == "withdrawal_hold":
        if account.debt_balance > 0 or account.balance < amount:
            raise APIError(
                409,
                "INSUFFICIENT_BALANCE",
                "Available balance is insufficient or refund debt remains",
            )
        balance_delta, frozen_delta = -amount, amount
    elif kind == "withdrawal_paid":
        if account.frozen_balance < amount:
            raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
        frozen_delta = -amount
    elif kind == "withdrawal_release":
        if account.frozen_balance < amount:
            raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
        repayment = min(amount, account.debt_balance)
        balance_delta, frozen_delta, debt_delta = amount - repayment, -amount, -repayment
    else:
        raise ValueError("Unknown wallet operation")
    await session.execute(
        update(model)
        .where(condition)
        .values(
            balance=model.balance + balance_delta,
            frozen_balance=model.frozen_balance + frozen_delta,
            total_earned=model.total_earned + earned_delta,
            debt_balance=model.debt_balance + debt_delta,
            updated_at=func.now(),
        )
    )
    session.add(
        WalletMovement(
            account_key=str(owner) if owner else "platform",
            user_id=owner,
            business_id=business_id,
            kind=kind,
            amount=amount,
            balance_delta=balance_delta,
            frozen_delta=frozen_delta,
            earned_delta=earned_delta,
            debt_delta=debt_delta,
        )
    )


async def lock_account(session: AsyncSession, owner: uuid.UUID | None):
    model = Wallet if owner is not None else PlatformWallet
    condition = Wallet.user_id == owner if owner is not None else PlatformWallet.id == "platform"
    account = (
        await session.scalars(select(model).where(condition).with_for_update())
    ).one_or_none()
    if account is None:
        raise ValueError(
            f"Wallet for agent {owner} is missing" if owner else "Platform wallet is missing"
        )
    return account
