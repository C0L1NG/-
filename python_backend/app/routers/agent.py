import base64
import math
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..binding import bind_direct_parent
from ..commission import calculate_order_commission, money
from ..db import get_session
from ..errors import APIError
from ..models import CommissionLog, CommissionRole, Order, PaymentStatus, SettlementStatus, User, UserRole, Wallet
from ..presentation import iso_utc, percent
from ..schemas import AgentOverview, LedgerPage, MiniProgramCode, ParentBinding, Referral, TeamPage, WechatLogin
from ..security import current_agent_id, sign_agent_token
from ..validation import agent_query, public_query
from ..wechat import new_referral_code

router = APIRouter(prefix="/api/agent", tags=["agent"], dependencies=[Depends(agent_query)])
public_agent_router = APIRouter(prefix="/api/agent", tags=["agent"])
auth_router = APIRouter(prefix="/api/auth", tags=["auth"], dependencies=[Depends(public_query)])


@public_agent_router.post("/logout", dependencies=[Depends(public_query)])
async def logout():
    response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
    response.delete_cookie("agent_access_token", path="/", httponly=True, samesite="lax")
    return response


@router.get("/overview", response_model=AgentOverview)
async def overview(agent_id: uuid.UUID = Depends(current_agent_id), session: AsyncSession = Depends(get_session)):
    wallet = await session.scalar(select(Wallet).where(Wallet.user_id == agent_id))
    agent = await session.get(User, agent_id)
    if wallet is None:
        raise APIError(409, "WALLET_NOT_FOUND", "Agent wallet is missing")
    if agent is None:
        raise APIError(401, "UNAUTHORIZED", "Account not found")
    count = await session.scalar(select(func.count()).select_from(User).where(
        User.parent_id == agent_id, User.role == UserRole.AGENT)) or 0
    start = datetime.combine(datetime.now(timezone.utc).date(), time.min, timezone.utc)
    end = start + timedelta(days=1)
    statement = select(Order.id, Order.promoter_id, Order.profit_amount, User.parent_id).join(
        User, User.id == Order.promoter_id).where(
        Order.payment_status == PaymentStatus.PAID,
        Order.settlement_status == SettlementStatus.PENDING,
        Order.created_at >= start, Order.created_at < end,
        or_(Order.promoter_id == agent_id, User.parent_id == agent_id),
    ).order_by(Order.id).limit(500)
    estimated = Decimal(0)
    cursor = None
    while True:
        batch = (await session.execute(statement.where(Order.id > cursor) if cursor else statement)).all()
        for order_id, promoter_id, profit, parent_id in batch:
            amounts = calculate_order_commission(profit, parent_id is not None)
            if promoter_id == agent_id:
                estimated += amounts.promoter_amount
            elif parent_id == agent_id:
                estimated += amounts.parent_amount or Decimal(0)
        if len(batch) < 500:
            break
        cursor = batch[-1][0]
    return {"displayName": agent.display_name if agent.display_name is not None else "代理伙伴", "avatarUrl": agent.avatar_url,
        "balance": money(wallet.balance), "totalEarned": money(wallet.total_earned),
        "directAgentCount": count, "currentCommissionRatePercent": 49 if agent.parent_id else 70,
        "todayEstimatedEarnings": money(estimated), "estimateDate": start.date().isoformat(),
        "estimateTimeZone": "UTC"}


@router.get("/referral", response_model=Referral)
async def referral(request: Request, agent_id: uuid.UUID = Depends(current_agent_id),
    session: AsyncSession = Depends(get_session)):
    code = await session.scalar(select(User.referral_code).where(User.id == agent_id))
    if not code:
        raise APIError(409, "REFERRAL_CODE_NOT_FOUND", "Agent referral code is missing")
    url = urlsplit(request.app.state.settings.referral_base_url)
    params = []
    replaced = False
    for key, value in parse_qsl(url.query, keep_blank_values=True):
        if key == "ref":
            if not replaced:
                params.append(("ref", code))
                replaced = True
        else:
            params.append((key, value))
    if not replaced:
        params.append(("ref", code))
    return {"referralCode": code, "referralUrl": urlunsplit((url.scheme, url.netloc,
        url.path or "/", urlencode(params), url.fragment))}


@router.get("/team", response_model=TeamPage)
async def team(page: int = Query(1, ge=1, le=10_000), pageSize: int = Query(20, ge=1, le=100),
    agent_id: uuid.UUID = Depends(current_agent_id), session: AsyncSession = Depends(get_session)):
    where = (User.parent_id == agent_id, User.role == UserRole.AGENT)
    total = await session.scalar(select(func.count()).select_from(User).where(*where)) or 0
    rows = (await session.execute(select(User, Wallet.total_earned).outerjoin(Wallet, Wallet.user_id == User.id)
        .where(*where).order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * pageSize).limit(pageSize))).all()
    ids = [user.id for user, _ in rows]
    contributions: dict[uuid.UUID, Decimal] = {}
    if ids:
        rewards = (await session.execute(select(Order.promoter_id, func.sum(CommissionLog.commission_amount))
            .join(Order, Order.id == CommissionLog.order_id).where(
            CommissionLog.recipient_id == agent_id, CommissionLog.role_type == CommissionRole.PARENT,
            Order.promoter_id.in_(ids)).group_by(Order.promoter_id))).all()
        contributions = {promoter_id: amount for promoter_id, amount in rewards}
    return {"page": page, "pageSize": pageSize, "total": total,
        "totalPages": math.ceil(total / pageSize), "items": [{
            "id": str(user.id), "displayName": user.display_name if user.display_name is not None else "未命名代理",
            "avatarUrl": user.avatar_url, "joinedAt": iso_utc(user.created_at),
            "totalEarned": money(earned), "contributionCommission": money(contributions.get(user.id)),
        } for user, earned in rows]}


class BindBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    referralCode: str = Field(min_length=1, max_length=64)


@router.post("/bind-parent", response_model=ParentBinding)
async def bind_parent(body: BindBody, request: Request, agent_id: uuid.UUID = Depends(current_agent_id)):
    return await bind_direct_parent(agent_id, body.referralCode, request.app.state.session_factory)


@router.get("/mini-program-code", response_model=MiniProgramCode)
async def mini_program_code(request: Request, agent_id: uuid.UUID = Depends(current_agent_id),
    session: AsyncSession = Depends(get_session)):
    wechat = request.app.state.wechat
    if wechat is None:
        raise APIError(501, "WECHAT_NOT_CONFIGURED")
    code = await session.scalar(select(User.referral_code).where(User.id == agent_id))
    if not code:
        raise APIError(409, "REFERRAL_CODE_NOT_FOUND")
    scene = "r=" + code
    if len(scene) > 32:
        raise APIError(409, "REFERRAL_CODE_TOO_LONG")
    page = "pages/home/index"
    data, content_type = await wechat.get_unlimited_code(scene, page)
    return {"scene": scene, "page": page,
        "imageDataUrl": f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"}


@router.get("/ledger", response_model=LedgerPage)
async def ledger(page: int = Query(1, ge=1, le=10_000), pageSize: int = Query(20, ge=1, le=100),
    from_date: date | None = Query(None, alias="from"), to: date | None = Query(None),
    roleType: str | None = Query(None, pattern="^(PROMOTER|PARENT)$"),
    agent_id: uuid.UUID = Depends(current_agent_id), session: AsyncSession = Depends(get_session)):
    filters = [CommissionLog.recipient_id == agent_id]
    if from_date:
        filters.append(CommissionLog.created_at >= datetime.combine(from_date, time.min, timezone.utc))
    if to:
        filters.append(CommissionLog.created_at < datetime.combine(to, time.min, timezone.utc))
    if roleType:
        filters.append(CommissionLog.role_type == CommissionRole[roleType])
    total = await session.scalar(select(func.count()).select_from(CommissionLog).where(*filters)) or 0
    rows = (await session.execute(select(CommissionLog, Order).join(Order, Order.id == CommissionLog.order_id)
        .where(*filters).order_by(CommissionLog.created_at.desc(), CommissionLog.id.desc())
        .offset((page - 1) * pageSize).limit(pageSize))).all()
    return {"page": page, "pageSize": pageSize, "total": total,
        "totalPages": math.ceil(total / pageSize), "items": [{
            "id": str(log.id), "orderNo": order.order_no,
            "orderProfitAmount": money(order.profit_amount), "roleType": log.role_type.name,
            "earningType": "DOWNLINE_REWARD" if log.role_type == CommissionRole.PARENT else "OWN_ORDER",
            "rate": format(log.rate.normalize(), "f"), "ratePercent": percent(log.rate),
            "commissionAmount": money(log.commission_amount),
            "settlementStatus": order.settlement_status.name, "settledAt": iso_utc(log.created_at),
        } for log, order in rows]}


class WechatLoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=128)


@auth_router.post("/wechat/login", response_model=WechatLogin)
async def wechat_login(body: WechatLoginBody, request: Request):
    wechat = request.app.state.wechat
    if wechat is None:
        raise APIError(501, "WECHAT_NOT_CONFIGURED")
    external = await wechat.code2session(body.code)
    async with request.app.state.session_factory() as session:
        async with session.begin():
            statement = pg_insert(User).values(role=UserRole.AGENT,
                wechat_open_id=external.open_id, wechat_union_id=external.union_id,
                referral_code=new_referral_code()).on_conflict_do_nothing(
                index_elements=[User.wechat_open_id]).returning(User.id)
            new_id = await session.scalar(statement)
            if new_id:
                await session.execute(insert(Wallet).values(user_id=new_id))
            elif external.union_id:
                await session.execute(update(User).where(User.wechat_open_id == external.open_id)
                    .values(wechat_union_id=external.union_id, updated_at=func.now()))
            user = await session.scalar(select(User).where(User.wechat_open_id == external.open_id))
            if user is None:
                raise APIError(401, "UNAUTHORIZED", "Account not found")
            if user.role != UserRole.AGENT:
                raise APIError(403, "AGENT_ACCESS_ONLY")
            result = {"accessToken": sign_agent_token(user.id, request), "expiresIn": 7200,
                "agent": {"id": str(user.id), "parentId": str(user.parent_id) if user.parent_id else None}}
    return result
