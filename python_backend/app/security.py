import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from .db import begin_read_snapshot, get_session
from .errors import APIError
from .models import User, UserRole

UUID_TEXT = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
bearer_scheme = HTTPBearer(auto_error=False)


async def require_role(
    request: Request,
    session: AsyncSession,
    role: UserRole,
    audience: str,
    credentials: HTTPAuthorizationCredentials | None,
) -> uuid.UUID:
    bearer = (
        credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else ""
    )
    cookie_name = "admin_access_token" if role == UserRole.ADMIN else "agent_access_token"
    token = bearer or request.cookies.get(cookie_name)
    if not token:
        raise APIError(401, "UNAUTHORIZED", "Valid bearer token required")
    try:
        claims = jwt.decode(
            token,
            request.app.state.settings.jwt_secret,
            algorithms=["HS256"],
            audience=audience,
            issuer=request.app.state.settings.jwt_issuer,
            options={"require": ["sub", "exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise APIError(401, "UNAUTHORIZED", "Valid bearer token required") from exc
    subject = claims.get("sub")
    if (
        not isinstance(subject, str)
        or not UUID_TEXT.fullmatch(subject)
        or type(claims.get("exp")) is not int
    ):
        raise APIError(401, "UNAUTHORIZED", "Invalid token claims")
    if request.method == "GET":
        # Validate the JWT before acquiring a DB connection; identity and finance share a snapshot.
        await begin_read_snapshot(session)
    user = await session.get(User, uuid.UUID(subject))
    if user is None or user.is_active is False:
        raise APIError(401, "UNAUTHORIZED", "Account not found")
    if claims.get("ver", 0) != (user.token_version or 0):
        raise APIError(401, "SESSION_REVOKED", "Please sign in again")
    if user.role != role:
        raise APIError(403, "FORBIDDEN", f"{role.name} access only")
    return user.id


async def current_agent_id(
    request: Request,
    session: AsyncSession = Depends(get_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> uuid.UUID:
    return await require_role(
        request, session, UserRole.AGENT, request.app.state.settings.jwt_audience, credentials
    )


async def current_admin_id(
    request: Request,
    session: AsyncSession = Depends(get_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> uuid.UUID:
    return await require_role(
        request, session, UserRole.ADMIN, request.app.state.settings.admin_jwt_audience, credentials
    )


def sign_token(user_id: uuid.UUID, request: Request, role: UserRole, version: int = 0) -> str:
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user_id),
            "iss": settings.jwt_issuer,
            "aud": settings.admin_jwt_audience if role == UserRole.ADMIN else settings.jwt_audience,
            "ver": version,
            "iat": now,
            "exp": now + timedelta(hours=2),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def sign_agent_token(user_id: uuid.UUID, request: Request, version: int = 0) -> str:
    return sign_token(user_id, request, UserRole.AGENT, version)


def hash_password(password: str) -> str:
    if not 12 <= len(password) <= 512:
        raise ValueError("Password must contain 12 to 512 characters")
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, maxmem=64 * 1024 * 1024)
    return (
        "scrypt$"
        + base64.urlsafe_b64encode(salt).decode()
        + "$"
        + base64.urlsafe_b64encode(key).decode()
    )


def verify_password(password: str, encoded: str | None) -> bool:
    try:
        kind, salt, expected = (encoded or "").split("$")
        if kind != "scrypt" or len(password) > 512:
            return False
        actual = hashlib.scrypt(
            password.encode(),
            salt=base64.urlsafe_b64decode(salt),
            n=16384,
            r=8,
            p=1,
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError):
        return False
