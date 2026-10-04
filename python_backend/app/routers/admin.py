import math
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..commission import money
from ..db import get_session
from ..errors import APIError
from ..exports import stream_audit_csv
from ..models import (
    CommissionLog,
    CommissionRole,
    Order,
    PlatformCommissionLog,
    User,
    UserRole,
    Wallet,
)
from ..periods import OverviewPeriod, period_range
from ..presentation import iso_utc, percent
from ..queries.admin_metrics import overview_totals
from ..queries.admin_network import network_page
from ..queries.admin_tree import load_admin_tree
from ..queries.audit_period import audit_period_filters, audit_window
from ..schemas import AdminOverview, AgentDetail, AuditPage, NetworkPage, TeamTree
from ..security import current_admin_id
from ..validation import admin_query

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_query)])


@router.get("/overview", response_model=AdminOverview, response_model_exclude_none=True)
async def overview(
    period: OverviewPeriod = "all",
    _admin_id: uuid.UUID = Depends(current_admin_id),
    session: AsyncSession = Depends(get_session),
):
    return await overview_totals(session, period)


@router.get("/team-tree", response_model=TeamTree)
async def team_tree(
    period: Literal["all", "month"] = "all",
    admin_id: uuid.UUID = Depends(current_admin_id),
    session: AsyncSession = Depends(get_session),
):
    return await load_admin_tree(session, admin_id, period_range(period))


@router.get("/team-network", response_model=NetworkPage)
async def team_network(
    period: Literal["all", "month"] = "all",
    parentId: uuid.UUID | None = None,
    page: int = Query(1, ge=1, le=10000),
    pageSize: int = Query(20, ge=1, le=100),
    q: str = Query("", max_length=80),
    _admin: uuid.UUID = Depends(current_admin_id),
    session: AsyncSession = Depends(get_session),
):
    return await network_page(session, parentId, page, pageSize, period_range(period), q)


@router.get("/agents/{agentId}", response_model=AgentDetail)
async def agent_detail(
    agentId: uuid.UUID,
    _admin_id: uuid.UUID = Depends(current_admin_id),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(
            select(User, Wallet)
            .outerjoin(Wallet, Wallet.user_id == User.id)
            .where(User.id == agentId, User.role == UserRole.AGENT)
        )
    ).one_or_none()
    if row is None:
        raise APIError(404, "AGENT_NOT_FOUND")
    agent, wallet = row
    child_count = (
        await session.scalar(
            select(func.count()).select_from(User).where(User.parent_id == agent.id)
        )
        or 0
    )
    order_count = (
        await session.scalar(
            select(func.count()).select_from(Order).where(Order.promoter_id == agent.id)
        )
        or 0
    )
    return {
        "id": str(agent.id),
        "parentId": str(agent.parent_id) if agent.parent_id else None,
        "displayName": agent.display_name if agent.display_name is not None else "未命名代理",
        "referralCode": agent.referral_code,
        "balance": money(wallet.balance if wallet else None),
        "frozenBalance": money(wallet.frozen_balance if wallet else None),
        "totalEarned": money(wallet.total_earned if wallet else None),
        "directAgentCount": child_count,
        "orderCount": order_count,
    }


@router.get("/commission-audit", response_model=AuditPage)
async def audit(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    period: Literal["all", "month"] = "all",
    q: str | None = Query(None, max_length=80),
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    _admin_id: uuid.UUID = Depends(current_admin_id),
    session: AsyncSession = Depends(get_session),
):
    window = audit_window(period, from_date, to)
    filters = audit_period_filters(window)
    text = q.strip() if q else ""
    if text:
        escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(
            or_(
                Order.order_no.ilike(f"%{escaped}%", escape="\\"),
                User.display_name.ilike(f"%{escaped}%", escape="\\"),
            )
        )
    base = (
        select(Order, User.id, User.display_name)
        .join(User, User.id == Order.promoter_id)
        .where(*filters)
    )
    total = (
        await session.scalar(
            select(func.count())
            .select_from(Order)
            .join(User, User.id == Order.promoter_id)
            .where(*filters)
        )
        or 0
    )
    rows = (
        await session.execute(
            base.order_by(Order.created_at.desc(), Order.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    ids = [order.id for order, _, _ in rows]
    platforms = {}
    allocations: dict[uuid.UUID, dict[CommissionRole, dict]] = {}
    if ids:
        platforms = {
            log.order_id: log
            for log in (
                await session.scalars(
                    select(PlatformCommissionLog).where(PlatformCommissionLog.order_id.in_(ids))
                )
            ).all()
        }
        split_rows = (
            await session.execute(
                select(CommissionLog, User.display_name)
                .join(User, User.id == CommissionLog.recipient_id)
                .where(CommissionLog.order_id.in_(ids))
            )
        ).all()
        for log, recipient_name in split_rows:
            allocations.setdefault(log.order_id, {})[log.role_type] = {
                "recipientId": str(log.recipient_id),
                "recipientName": recipient_name if recipient_name is not None else "未命名代理",
                "ratePercent": percent(log.rate),
                "amount": money(log.commission_amount),
            }
    return {
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "totalPages": math.ceil(total / pageSize),
        "items": [
            {
                "id": str(order.id),
                "orderNo": order.order_no,
                "totalAmount": money(order.total_amount),
                "profitAmount": money(order.profit_amount),
                "settlementStatus": order.settlement_status.name,
                "createdAt": iso_utc(order.created_at),
                "promoter": {
                    "id": str(promoter_id),
                    "displayName": promoter_name if promoter_name is not None else "未命名代理",
                },
                "platform": {
                    "ratePercent": percent(platforms[order.id].rate),
                    "amount": money(platforms[order.id].commission_amount),
                }
                if order.id in platforms
                else None,
                "promoterCommission": allocations.get(order.id, {}).get(CommissionRole.PROMOTER),
                "mentorCommission": allocations.get(order.id, {}).get(CommissionRole.PARENT),
            }
            for order, promoter_id, promoter_name in rows
        ],
    }


@router.get("/commission-export")
async def export_audit(
    request: Request,
    period: Literal["all", "month"] = "all",
    q: str = Query("", max_length=80),
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    _admin: uuid.UUID = Depends(current_admin_id),
):
    return StreamingResponse(
        stream_audit_csv(
            request.app.state.session_factory, period, q, audit_window(period, from_date, to)
        ),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="platform-reconciliation.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
