"""Net performance by promoter, using payment/settlement/refund event time."""

from sqlalchemy import func, literal, select, union_all

from ..models import (
    CommissionLog,
    CommissionRole,
    Order,
    PaymentStatus,
    PlatformCommissionLog,
    Refund,
)
from ..periods import in_period


def promoter_performance(window):
    paid = select(
        Order.promoter_id.label("owner"),
        Order.total_amount.label("amount"),
        literal(1).label("count"),
    ).where(
        Order.payment_status.in_([PaymentStatus.PAID, PaymentStatus.REFUNDED]),
        *in_period(Order.paid_at, window),
    )
    returned = (
        select(
            Order.promoter_id.label("owner"),
            (-Refund.total_amount).label("amount"),
            literal(0).label("count"),
        )
        .join(Refund, Refund.order_id == Order.id)
        .where(*in_period(Refund.created_at, window))
    )
    gmv_events = union_all(paid, returned).subquery()
    gmv = (
        select(
            gmv_events.c.owner,
            func.sum(gmv_events.c.amount).label("amount"),
            func.sum(gmv_events.c.count).label("count"),
        )
        .group_by(gmv_events.c.owner)
        .subquery()
    )
    original = (
        select(
            Order.promoter_id.label("owner"),
            PlatformCommissionLog.commission_amount.label("amount"),
        )
        .join(PlatformCommissionLog, PlatformCommissionLog.order_id == Order.id)
        .where(*in_period(PlatformCommissionLog.created_at, window))
    )
    reversal = (
        select(Order.promoter_id.label("owner"), (-Refund.platform_amount).label("amount"))
        .join(Refund, Refund.order_id == Order.id)
        .where(*in_period(Refund.created_at, window))
    )
    platform_events = union_all(original, reversal).subquery()
    platform = (
        select(platform_events.c.owner, func.sum(platform_events.c.amount).label("amount"))
        .group_by(platform_events.c.owner)
        .subquery()
    )
    mentor_income = (
        select(Order.promoter_id.label("owner"), CommissionLog.commission_amount.label("amount"))
        .join(CommissionLog, CommissionLog.order_id == Order.id)
        .where(
            CommissionLog.role_type == CommissionRole.PARENT,
            *in_period(CommissionLog.created_at, window),
        )
    )
    mentor_return = (
        select(Order.promoter_id.label("owner"), (-CommissionLog.commission_amount).label("amount"))
        .join(CommissionLog, CommissionLog.order_id == Order.id)
        .join(Refund, Refund.order_id == Order.id)
        .where(
            CommissionLog.role_type == CommissionRole.PARENT, *in_period(Refund.created_at, window)
        )
    )
    mentor_events = union_all(mentor_income, mentor_return).subquery()
    mentor = (
        select(mentor_events.c.owner, func.sum(mentor_events.c.amount).label("amount"))
        .group_by(mentor_events.c.owner)
        .subquery()
    )
    return gmv, platform, mentor
