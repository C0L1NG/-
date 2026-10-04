"""Formatting shared by the admin and agent API response builders."""

from datetime import datetime, timezone
from decimal import Decimal


def iso_utc(value: datetime) -> str:
    return (
        value.replace(tzinfo=value.tzinfo or timezone.utc)
        .astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def percent(value: Decimal) -> int | float:
    number = value * 100
    return int(number) if number == number.to_integral_value() else float(number)
