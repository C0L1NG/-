"""Stream a consistent PostgreSQL snapshot; escape spreadsheet formula prefixes."""

import csv
import io
from decimal import Decimal

from sqlalchemy import or_, select, text
from sqlalchemy.orm import aliased

from .commission import money
from .models import CommissionLog, CommissionRole, Order, PlatformCommissionLog, Refund, User
from .periods import period_range
from .presentation import iso_utc, percent
from .queries.audit_period import audit_period_filters


def csv_line(values):
    stream = io.StringIO()
    writer = csv.writer(stream)
    safe = []
    for value in values:
        numeric = isinstance(value, (Decimal, int, float)) and not isinstance(value, bool)
        value = str(value if value is not None else "")
        if not numeric and (
            value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r"))
        ):
            value = "'" + value
        safe.append(value)
    writer.writerow(safe)
    return stream.getvalue()


async def stream_audit_csv(session_factory, period, query, window=None):
    promoter_log, parent_log = aliased(CommissionLog), aliased(CommissionLog)
    parent_user = aliased(User)
    window = window if window is not None else period_range(period)
    filters = audit_period_filters(window)

    def included(at):
        return at is not None and (window is None or window[0] <= at < window[1])

    if query:
        escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(
            or_(
                Order.order_no.ilike(f"%{escaped}%", escape="\\"),
                User.display_name.ilike(f"%{escaped}%", escape="\\"),
            )
        )
    statement = (
        select(
            Order,
            User.display_name,
            PlatformCommissionLog.commission_amount,
            promoter_log.rate,
            promoter_log.commission_amount,
            parent_user.display_name,
            parent_log.rate,
            parent_log.commission_amount,
            PlatformCommissionLog.created_at,
            Refund,
        )
        .join(User, User.id == Order.promoter_id)
        .outerjoin(Refund, Refund.order_id == Order.id)
        .outerjoin(PlatformCommissionLog, PlatformCommissionLog.order_id == Order.id)
        .outerjoin(
            promoter_log,
            (promoter_log.order_id == Order.id)
            & (promoter_log.role_type == CommissionRole.PROMOTER),
        )
        .outerjoin(
            parent_log,
            (parent_log.order_id == Order.id) & (parent_log.role_type == CommissionRole.PARENT),
        )
        .outerjoin(parent_user, parent_user.id == parent_log.recipient_id)
        .where(*filters)
        .order_by(Order.created_at, Order.id)
        .execution_options(yield_per=500)
    )
    async with session_factory() as session:
        async with session.begin():
            await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            # Start the database snapshot before yielding the first response bytes.
            result = await session.stream(statement)
            yield "\ufeff" + csv_line(
                [
                    "订单号",
                    "创建时间 UTC",
                    "支付时间 UTC",
                    "结算时间 UTC",
                    "订单金额",
                    "利润池",
                    "平台原始分成 30%",
                    "出单人",
                    "比例",
                    "原始入账",
                    "导师",
                    "比例",
                    "原始导师入账",
                    "状态",
                    "退款时间 UTC",
                    "当期净GMV",
                    "当期平台净收益",
                    "当期代理净佣金",
                ]
            )
            async for (
                order,
                name,
                platform,
                own_rate,
                own,
                parent,
                parent_rate,
                reward,
                settled_at,
                refund,
            ) in result:
                zero = Decimal("0.00")
                refund_in_period = refund is not None and included(refund.created_at)
                net_gmv = (order.total_amount if included(order.paid_at) else zero) - (
                    refund.total_amount if refund_in_period else zero
                )
                net_platform = (
                    platform if platform is not None and included(settled_at) else zero
                ) - (refund.platform_amount if refund_in_period else zero)
                net_agents = (
                    (own or zero) + (reward or zero) if included(settled_at) else zero
                ) - (refund.agent_amount if refund_in_period else zero)
                yield csv_line(
                    [
                        order.order_no,
                        iso_utc(order.created_at),
                        iso_utc(order.paid_at) if order.paid_at else "",
                        iso_utc(order.settled_at) if order.settled_at else "",
                        money(order.total_amount),
                        money(order.profit_amount),
                        money(platform) if platform is not None else "",
                        name,
                        percent(own_rate) if own_rate is not None else "",
                        money(own) if own is not None else "",
                        parent,
                        percent(parent_rate) if parent_rate is not None else "",
                        money(reward) if reward is not None else "",
                        order.settlement_status.name,
                        iso_utc(order.refunded_at) if order.refunded_at else "",
                        net_gmv.quantize(Decimal("0.01")),
                        net_platform.quantize(Decimal("0.01")),
                        net_agents.quantize(Decimal("0.01")),
                    ]
                )
