"""Include orders with payment, settlement or refund events in the selected period."""

from datetime import datetime, time, timezone

from sqlalchemy import and_, exists, or_, select

from ..errors import APIError
from ..models import Order, PlatformCommissionLog, Refund
from ..periods import in_period, period_range


def audit_window(period, start=None, end=None):
    if start is None and end is None:
        return period_range(period)
    if start is not None and end is not None and start >= end:
        raise APIError(400, "INVALID_DATE_RANGE")
    return (
        datetime.combine(start, time.min, timezone.utc)
        if start
        else datetime.min.replace(tzinfo=timezone.utc),
        datetime.combine(end, time.min, timezone.utc)
        if end
        else datetime.max.replace(tzinfo=timezone.utc),
    )


def audit_period_filters(window):
    if window is None:
        return []
    settled = exists(
        select(PlatformCommissionLog.id)
        .where(
            PlatformCommissionLog.order_id == Order.id,
            *in_period(PlatformCommissionLog.created_at, window),
        )
        .correlate(Order)
    )
    refunded = exists(
        select(Refund.id)
        .where(Refund.order_id == Order.id, *in_period(Refund.created_at, window))
        .correlate(Order)
    )
    return [
        or_(
            and_(*in_period(Order.paid_at, window)),
            settled,
            refunded,
            and_(Order.paid_at.is_(None), *in_period(Order.created_at, window)),
        )
    ]
