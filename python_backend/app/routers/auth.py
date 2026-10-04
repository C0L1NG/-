"""Admin password login and a short-lived, single-use mini-program to Web bridge."""

import asyncio
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update

from ..db import get_session
from ..errors import APIError
from ..models import User, UserRole, WebLoginTicket
from ..schemas import LoginTicket, SessionLogin
from ..security import current_admin_id, current_agent_id, require_role, sign_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["authentication"])


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=512)


def login_response(user: User, request: Request) -> JSONResponse:
    token = sign_token(user.id, request, user.role, user.token_version or 0)
    response = JSONResponse(
        {"accessToken": token, "expiresIn": 7200, "role": user.role.value},
        headers={"Cache-Control": "no-store"},
    )
    response.set_cookie(
        "admin_access_token" if user.role == UserRole.ADMIN else "agent_access_token",
        token,
        max_age=7200,
        path="/",
        httponly=True,
        secure=request.app.state.settings.secure_cookies,
        samesite="lax",
    )
    response.delete_cookie(
        "agent_access_token" if user.role == UserRole.ADMIN else "admin_access_token", path="/"
    )
    return response


@router.post("/admin/login", response_model=SessionLogin)
async def admin_login(body: LoginBody, request: Request, session=Depends(get_session)):
    user = await session.scalar(
        select(User).where(User.login_name == body.username, User.role == UserRole.ADMIN)
    )
    # Hash on the worker thread; use a dummy hash for absent usernames to avoid cheap probes.
    encoded = user.password_hash if user else request.app.state.dummy_password_hash
    valid = await asyncio.to_thread(verify_password, body.password, encoded)
    if not valid or not user or not user.is_active:
        raise APIError(401, "INVALID_CREDENTIALS", "Username or password is incorrect")
    return login_response(user, request)


@router.post("/web-ticket", response_model=LoginTicket)
async def web_ticket(request: Request, agent_id: uuid.UUID = Depends(current_agent_id)):
    return await create_ticket(request, agent_id)


@router.post("/admin/web-ticket", response_model=LoginTicket)
async def admin_web_ticket(request: Request, admin_id: uuid.UUID = Depends(current_admin_id)):
    return await create_ticket(request, admin_id)


async def create_ticket(request: Request, user_id: uuid.UUID):
    ticket = secrets.token_urlsafe(32)
    async with request.app.state.session_factory() as session:
        async with session.begin():
            user = await session.get(User, user_id)
            if not user or not user.is_active:
                raise APIError(401, "SESSION_REVOKED")
            session.add(
                WebLoginTicket(
                    id=hashlib.sha256(ticket.encode()).hexdigest(),
                    user_id=user_id,
                    role=user.role.value,
                    token_version=user.token_version,
                    expires_at=datetime.now(timezone.utc) + timedelta(seconds=60),
                )
            )
    return {"ticket": ticket, "expiresIn": 60}


class ExchangeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket: str = Field(min_length=32, max_length=128)


class AdminWechatBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=128)


@router.post("/wechat/admin-login", response_model=SessionLogin)
async def admin_wechat_login(body: AdminWechatBody, request: Request, session=Depends(get_session)):
    if request.app.state.admin_wechat is None:
        raise APIError(501, "WECHAT_NOT_CONFIGURED")
    external = await request.app.state.admin_wechat.code2session(body.code)
    user = await session.scalar(
        select(User).where(
            User.wechat_open_id == external.open_id,
            User.role == UserRole.ADMIN,
            User.is_active.is_(True),
        )
    )
    if not user:
        raise APIError(403, "ADMIN_WECHAT_IDENTITY_NOT_LINKED")
    return login_response(user, request)


@router.post("/web/exchange", response_model=SessionLogin)
async def exchange_ticket(body: ExchangeBody, request: Request):
    async with request.app.state.session_factory() as session:
        async with session.begin():
            ticket = await session.scalar(
                select(WebLoginTicket)
                .where(WebLoginTicket.id == hashlib.sha256(body.ticket.encode()).hexdigest())
                .with_for_update()
            )
            if not ticket or ticket.consumed_at or ticket.expires_at <= datetime.now(timezone.utc):
                raise APIError(401, "LOGIN_TICKET_EXPIRED")
            user = await session.get(User, ticket.user_id)
            if (
                not user
                or not user.is_active
                or user.role.value != ticket.role
                or user.token_version != ticket.token_version
            ):
                raise APIError(401, "SESSION_REVOKED")
            ticket.consumed_at = datetime.now(timezone.utc)
            return login_response(user, request)


async def revoke_session(request: Request, role: UserRole) -> None:
    name = "admin_access_token" if role == UserRole.ADMIN else "agent_access_token"
    auth = request.headers.get("authorization", "")
    if not request.cookies.get(name) and not auth:
        return
    from fastapi.security import HTTPAuthorizationCredentials

    credentials = (
        HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth[7:])
        if auth.startswith("Bearer ")
        else None
    )
    async with request.app.state.session_factory() as session:
        audience = (
            request.app.state.settings.admin_jwt_audience
            if role == UserRole.ADMIN
            else request.app.state.settings.jwt_audience
        )
        try:
            user_id = await require_role(request, session, role, audience, credentials)
        except APIError as exc:
            if exc.status_code == 401:
                return
            raise
        await session.execute(
            update(User).where(User.id == user_id).values(token_version=User.token_version + 1)
        )
        await session.commit()


@router.post("/admin/logout")
async def admin_logout(request: Request):
    await revoke_session(request, UserRole.ADMIN)
    response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
    response.delete_cookie("admin_access_token", path="/")
    return response
