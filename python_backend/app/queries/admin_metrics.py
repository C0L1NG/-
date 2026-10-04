from decimal import Decimal

from sqlalchemy import func, select

from ..commission import money
from ..models import (
    CommissionLog,
    Order,
    PaymentStatus,
    PlatformCommissionLog,
    Refund,
    User,
    UserRole,
)
from ..periods import in_period, period_range


async def overview_totals(session, period):
    window = period_range(period)
    platform = await session.scalar(
        select(func.sum(PlatformCommissionLog.commission_amount)).where(
            *in_period(PlatformCommissionLog.created_at, window)
        )
    ) or Decimal(0)
    agent = await session.scalar(
        select(func.sum(CommissionLog.commission_amount)).where(
            *in_period(CommissionLog.created_at, window)
        )
    ) or Decimal(0)
    platform_refunds = await session.scalar(
        select(func.sum(Refund.platform_amount)).where(*in_period(Refund.created_at, window))
    ) or Decimal(0)
    agent_refunds = await session.scalar(
        select(func.sum(Refund.agent_amount)).where(*in_period(Refund.created_at, window))
    ) or Decimal(0)
    paid = [
        Order.payment_status.in_([PaymentStatus.PAID, PaymentStatus.REFUNDED]),
        *in_period(Order.paid_at, window),
    ]
    gmv, count = (
        await session.execute(select(func.sum(Order.total_amount), func.count()).where(*paid))
    ).one()
    refunds = await session.scalar(
        select(func.sum(Refund.total_amount)).where(*in_period(Refund.created_at, window))
    ) or Decimal(0)
    agents = (
        await session.scalar(
            select(func.count()).select_from(User).where(User.role == UserRole.AGENT)
        )
        or 0
    )
    result = {
        "platformTotalRevenue": money(platform - platform_refunds),
        "totalGmv": money((gmv or 0) - refunds),
        "agentCommissionPool": money(agent - agent_refunds),
        "agentCount": agents,
        "paidOrderCount": count,
    }
    if period == "day":
        result["activePromoterCount"] = (
            await session.scalar(select(func.count(func.distinct(Order.promoter_id))).where(*paid))
            or 0
        )
    return result
