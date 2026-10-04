"""Exact-cent, transaction-safe settlement against the existing PostgreSQL schema."""

import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import (
    CommissionLog,
    CommissionRole,
    Order,
    PaymentStatus,
    PlatformCommissionLog,
    SettlementStatus,
)
from .wallets import move_account

CENT = Decimal("0.01")


def money(value: Decimal | str | int | None) -> str:
    return format(Decimal(value if value is not None else 0).quantize(CENT), ".2f")


@dataclass(frozen=True)
class CommissionAmounts:
    profit_amount: Decimal
    platform_amount: Decimal
    bonus_pool: Decimal
    promoter_amount: Decimal
    parent_amount: Decimal | None


def calculate_order_commission(profit_amount: str | Decimal, has_parent: bool) -> CommissionAmounts:
    try:
        profit = Decimal(profit_amount)
    except (InvalidOperation, TypeError) as exc:
        raise ValueError("profitAmount must be a nonnegative amount in cents") from exc
    if not profit.is_finite() or profit < 0 or profit != profit.quantize(CENT):
        raise ValueError("profitAmount must be a nonnegative amount in cents")
    profit = profit.quantize(CENT)
    platform = (profit * Decimal("0.30")).quantize(CENT, rounding=ROUND_HALF_UP)
    pool = profit - platform
    promoter = (
        (pool * Decimal("0.70")).quantize(CENT, rounding=ROUND_HALF_UP) if has_parent else pool
    )
    parent = pool - promoter if has_parent else None
    return CommissionAmounts(profit, platform, pool, promoter, parent)


@lru_cache(maxsize=1)
def _default_session_factory() -> async_sessionmaker[AsyncSession]:
    from .config import Settings
    from .db import make_session_factory

    factory, _engine = make_session_factory(Settings.from_env().database_url)
    return factory


async def process_order_commission(
    order_id: str,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> dict[str, str | None]:
    """Settle once. Every wallet increment, log and status change shares one transaction."""
    if not order_id:
        raise TypeError("orderId is required")
    order_uuid = uuid.UUID(order_id)
    session_factory = session_factory or _default_session_factory()
    async with session_factory() as session:
        async with session.begin():
            order = (
                await session.scalars(select(Order).where(Order.id == order_uuid).with_for_update())
            ).one_or_none()
            if order is None:
                raise ValueError(f"Order {order_id} does not exist")
            return await settle_locked_order(session, order)


async def settle_locked_order(session: AsyncSession, order: Order) -> dict:
    """Caller owns the order row lock and transaction, including verified payment."""
    order_id = str(order.id)
    if order.settlement_status == SettlementStatus.SETTLED:
        return {"status": "already_settled", "orderId": order_id}
    if order.payment_status != PaymentStatus.PAID:
        raise ValueError(f"Order {order_id} has not been paid")
    if order.settlement_status != SettlementStatus.PENDING:
        raise ValueError(f"Order {order_id} cannot be settled from {order.settlement_status.value}")
    if not order.attribution_locked_at or order.rule_version != "two_level_v1":
        raise ValueError("Order attribution migration is required")
    parent_id = order.attribution_parent_id
    amounts = calculate_order_commission(order.profit_amount, parent_id is not None)
    allocations = [
        (
            order.promoter_id,
            CommissionRole.PROMOTER,
            Decimal("0.49") if parent_id else Decimal("0.70"),
            amounts.promoter_amount,
        )
    ]
    if parent_id:
        allocations.append(
            (parent_id, CommissionRole.PARENT, Decimal("0.21"), amounts.parent_amount)
        )
    # All services lock platform first, then agent wallets by UUID.
    await move_account(session, None, order_id, "commission", amounts.platform_amount)
    for user_id, _, _, amount in sorted(allocations, key=lambda item: item[0].hex):
        await move_account(session, user_id, order_id, "commission", amount)
    session.add(
        PlatformCommissionLog(
            order_id=order.id, rate=Decimal("0.30"), commission_amount=amounts.platform_amount
        )
    )
    session.add_all(
        CommissionLog(
            order_id=order.id,
            recipient_id=user_id,
            role_type=role_type,
            rate=rate,
            commission_amount=amount,
        )
        for user_id, role_type, rate, amount in allocations
    )
    order.settlement_status = SettlementStatus.SETTLED
    order.settled_at = func.now()
    order.updated_at = func.now()
    return {
        "status": "settled",
        "orderId": order_id,
        "platformAmount": money(amounts.platform_amount),
        "bonusPool": money(amounts.bonus_pool),
        "promoterAmount": money(amounts.promoter_amount),
        "parentAmount": money(amounts.parent_amount) if amounts.parent_amount is not None else None,
    }
