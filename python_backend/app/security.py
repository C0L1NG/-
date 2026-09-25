import re
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .errors import APIError
from .models import User, UserRole

UUID_TEXT = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
bearer_scheme = HTTPBearer(auto_error=False)


async def require_role(request: Request, session: AsyncSession, role: UserRole, audience: str,
    credentials: HTTPAuthorizationCredentials | None) -> uuid.UUID:
    bearer = credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else ""
    cookie_name = "admin_access_token" if role == UserRole.ADMIN else "agent_access_token"
    token = bearer or request.cookies.get(cookie_name)
    if not token:
        raise APIError(401, "UNAUTHORIZED", "Valid bearer token required")
    try:
        claims = jwt.decode(token, request.app.state.settings.jwt_secret, algorithms=["HS256"],
            audience=audience, issuer=request.app.state.settings.jwt_issuer,
            options={"require": ["sub", "exp", "iss", "aud"]})
    except jwt.PyJWTError as exc:
        raise APIError(401, "UNAUTHORIZED", "Valid bearer token required") from exc
    subject = claims.get("sub")
    if not isinstance(subject, str) or not UUID_TEXT.fullmatch(subject) or type(claims.get("exp")) is not int:
        raise APIError(401, "UNAUTHORIZED", "Invalid token claims")
    user = await session.get(User, uuid.UUID(subject))
    if user is None:
        raise APIError(401, "UNAUTHORIZED", "Account not found")
    if user.role != role:
        raise APIError(403, "FORBIDDEN", f"{role.name} access only")
    return user.id


async def current_agent_id(request: Request, session: AsyncSession = Depends(get_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> uuid.UUID:
    return await require_role(request, session, UserRole.AGENT,
        request.app.state.settings.jwt_audience, credentials)


async def current_admin_id(request: Request, session: AsyncSession = Depends(get_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> uuid.UUID:
    return await require_role(request, session, UserRole.ADMIN,
        request.app.state.settings.admin_jwt_audience, credentials)


def sign_agent_token(user_id: uuid.UUID, request: Request) -> str:
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience, "iat": now, "exp": now + timedelta(hours=2)},
        settings.jwt_secret, algorithm="HS256")
