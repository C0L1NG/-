from decimal import Decimal

from sqlalchemy import String, case, cast, func, or_, select

from ..commission import money
from ..models import (
    CommissionLog,
    CommissionRole,
    Order,
    PaymentStatus,
    SettlementStatus,
    User,
    UserRole,
    Wallet,
    WalletMovement,
)
from ..periods import in_period, period_range
from ..presentation import iso_utc


async def income_totals(session, agent_id, window):
    income = dict(
        (
            await session.execute(
                select(CommissionLog.role_type, func.sum(CommissionLog.commission_amount))
                .where(
                    CommissionLog.recipient_id == agent_id,
                    *in_period(CommissionLog.created_at, window),
                )
                .group_by(CommissionLog.role_type)
            )
        ).all()
    )
    # Refund adjustments occur in the refund period; original commission records stay intact.
    earning_role = case((Order.promoter_id == agent_id, "promoter"), else_="parent").label(
        "earning_role"
    )
    reversals = dict(
        (
            await session.execute(
                select(earning_role, func.sum(WalletMovement.earned_delta))
                .join(Order, cast(Order.id, String) == WalletMovement.business_id)
                .where(
                    WalletMovement.user_id == agent_id,
                    WalletMovement.kind == "refund",
                    *in_period(WalletMovement.created_at, window),
                )
                .group_by(earning_role)
            )
        ).all()
    )
    return {
        role: (income.get(role) or Decimal(0)) + (reversals.get(role.value) or Decimal(0))
        for role in CommissionRole
    }


async def today_estimate(session, agent_id):
    window = period_range("day")
    settled = await income_totals(session, agent_id, window)
    # Match the cent-conserving calculation: round platform first, then split remainder.
    pool = Order.profit_amount - func.round(Order.profit_amount * Decimal("0.30"), 2)
    own_share = func.round(pool * Decimal("0.70"), 2)
    amount = case(
        (
            Order.promoter_id == agent_id,
            case((Order.attribution_parent_id.is_(None), pool), else_=own_share),
        ),
        else_=pool - own_share,
    )
    pending = await session.scalar(
        select(func.sum(amount)).where(
            Order.payment_status == PaymentStatus.PAID,
            Order.settlement_status == SettlementStatus.PENDING,
            *in_period(Order.paid_at, window),
            or_(Order.promoter_id == agent_id, Order.attribution_parent_id == agent_id),
        )
    )
    return sum(settled.values(), Decimal(0)) + (pending or Decimal(0))


async def progress_summary(session, agent_id):
    window = period_range("month")
    totals = await income_totals(session, agent_id, window)
    team = [User.parent_id == agent_id, User.role == UserRole.AGENT]
    count = await session.scalar(select(func.count()).select_from(User).where(*team)) or 0
    contribution = (
        select(
            Order.promoter_id.label("promoter_id"),
            func.sum(CommissionLog.commission_amount).label("amount"),
        )
        .join(Order, Order.id == CommissionLog.order_id)
        .where(
            CommissionLog.recipient_id == agent_id,
            CommissionLog.role_type == CommissionRole.PARENT,
            Order.settlement_status != SettlementStatus.REVERSED,
        )
        .group_by(Order.promoter_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(User, Wallet.total_earned, contribution.c.amount)
            .outerjoin(Wallet, Wallet.user_id == User.id)
            .outerjoin(contribution, contribution.c.promoter_id == User.id)
            .where(*team)
            .order_by(func.coalesce(contribution.c.amount, 0).desc(), User.id)
            .limit(4)
        )
    ).all()
    return {
        "month": window[0].strftime("%Y-%m"),
        "timeZone": "UTC",
        "directAgentCount": count,
        "ownEarnings": money(totals[CommissionRole.PROMOTER]),
        "teamEarnings": money(totals[CommissionRole.PARENT]),
        "monthEarned": money(sum(totals.values(), Decimal(0))),
        "leaders": [
            {
                "id": str(user.id),
                "displayName": user.display_name or "未命名代理",
                "avatarUrl": user.avatar_url,
                "joinedAt": iso_utc(user.created_at),
                "totalEarned": money(earned),
                "contributionCommission": money(amount),
            }
            for user, earned, amount in rows
        ],
    }
