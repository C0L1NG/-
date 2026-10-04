"""Agent-scoped immutable commission and refund events, ordered by event time."""

import math

from sqlalchemy import String, cast, func, literal, select, union_all

from ..commission import money
from ..models import CommissionLog, CommissionRole, Order, WalletMovement
from ..periods import in_period
from ..presentation import iso_utc, percent


async def activity_page(session, agent_id, page, page_size, window, role_type):
    columns = [Order.order_no, Order.profit_amount, CommissionLog.role_type, CommissionLog.rate]
    original = (
        select(
            CommissionLog.id.label("id"),
            *columns,
            CommissionLog.commission_amount.label("amount"),
            CommissionLog.created_at.label("event_at"),
            Order.settlement_status.label("status"),
            literal("commission").label("entry_type"),
        )
        .join(Order, Order.id == CommissionLog.order_id)
        .where(CommissionLog.recipient_id == agent_id)
    )
    reversal = (
        select(
            WalletMovement.id.label("id"),
            *columns,
            WalletMovement.earned_delta.label("amount"),
            WalletMovement.created_at.label("event_at"),
            Order.settlement_status.label("status"),
            literal("refund").label("entry_type"),
        )
        .select_from(WalletMovement)
        .join(Order, cast(Order.id, String) == WalletMovement.business_id)
        .join(
            CommissionLog,
            (CommissionLog.order_id == Order.id) & (CommissionLog.recipient_id == agent_id),
        )
        .where(WalletMovement.user_id == agent_id, WalletMovement.kind == "refund")
    )
    events = union_all(original, reversal).subquery()
    filters = in_period(events.c.event_at, window)
    if role_type:
        filters.append(events.c.role_type == CommissionRole[role_type])
    total = await session.scalar(select(func.count()).select_from(events).where(*filters)) or 0
    rows = (
        (
            await session.execute(
                select(events)
                .where(*filters)
                .order_by(events.c.event_at.desc(), events.c.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .mappings()
        .all()
    )
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": math.ceil(total / page_size),
        "items": [
            {
                "id": str(row["id"]),
                "orderNo": row["order_no"],
                "orderProfitAmount": money(row["profit_amount"]),
                "roleType": row["role_type"].name,
                "earningType": "OWN_ORDER"
                if row["role_type"] == CommissionRole.PROMOTER
                else "DOWNLINE_REWARD",
                "rate": format(row["rate"].normalize(), "f"),
                "ratePercent": percent(row["rate"]),
                "commissionAmount": money(row["amount"]),
                "settlementStatus": row["status"].name,
                "settledAt": iso_utc(row["event_at"]),
                "entryType": row["entry_type"],
            }
            for row in rows
        ],
    }
