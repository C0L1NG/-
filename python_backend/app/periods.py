"""UTC reporting windows shared by administrative read models."""

from datetime import datetime, timedelta, timezone
from typing import Literal

OverviewPeriod = Literal["all", "month", "previous_month", "day"]


def period_range(period: OverviewPeriod) -> tuple[datetime, datetime] | None:
    if period == "all":
        return None
    now = datetime.now(timezone.utc)
    if period == "day":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)
    year, month = now.year, now.month - (period == "previous_month")
    if month == 0:
        year, month = year - 1, 12
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


def in_period(column, period: tuple[datetime, datetime] | None):
    return [column >= period[0], column < period[1]] if period else []
