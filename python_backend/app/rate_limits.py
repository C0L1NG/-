"""Shared login limits. Forwarded identity is accepted only with a BFF MAC."""

import hashlib
import hmac
import json
import re
import time

from sqlalchemy import text

from .errors import APIError

LOGIN_PATHS = {
    "/api/auth/admin/login",
    "/api/auth/wechat/login",
    "/api/auth/wechat/admin-login",
    "/api/auth/web/exchange",
}


def signed_client(request, body, secret):
    client = request.headers.get("x-bff-client", "")
    timestamp = request.headers.get("x-bff-timestamp", "")
    signature = request.headers.get("x-bff-signature", "")
    if not any((client, timestamp, signature)):
        return None
    try:
        valid_time = abs(time.time() - int(timestamp)) <= 60
    except ValueError:
        valid_time = False
    if len(secret) < 32 or not valid_time or not re.fullmatch(r"[a-f0-9]{64}", client):
        raise APIError(401, "INVALID_BFF_CONTEXT")
    canonical = "\n".join(
        (timestamp, request.method, request.url.path, client, hashlib.sha256(body).hexdigest())
    )
    expected = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise APIError(401, "INVALID_BFF_CONTEXT")
    return client


async def check_login_limit(request):
    if request.method != "POST" or request.url.path not in LOGIN_PATHS:
        return
    # Bound request parsing before password hashing. Content-length is not trusted.
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 8192:
            raise APIError(413, "PAYLOAD_TOO_LARGE")
        chunks.append(chunk)
    body = b"".join(chunks)
    request._body = body  # Starlette's cached body is replayed to the downstream handler.
    client = signed_client(request, body, request.app.state.settings.bff_context_secret)
    source = (
        "bff:" + client
        if client
        else "direct:" + (request.client.host if request.client else "unknown")
    )
    keys = [(source + ":" + request.url.path, 20)]
    # Rotating browser identifiers does not reset the account limit. No password is stored.
    if request.url.path == "/api/auth/admin/login":
        try:
            username = json.loads(body).get("username")
        except (ValueError, AttributeError):
            username = None
        if isinstance(username, str) and len(username) <= 80:
            keys.append(("account:" + username, 100))
    limited = False
    async with request.app.state.session_factory() as session:
        async with session.begin():
            # Server/database clock, atomic UPSERT, same counters across all API workers.
            for identity, limit in sorted(keys):
                count = await session.scalar(
                    text("""
                    INSERT INTO auth_rate_limits(key,window_start,attempts)
                    VALUES (:key, floor(extract(epoch FROM clock_timestamp())/60)::bigint,1)
                    ON CONFLICT(key,window_start) DO UPDATE SET attempts=auth_rate_limits.attempts+1
                    RETURNING attempts
                """),
                    {"key": hashlib.sha256(identity.encode()).hexdigest()},
                )
                limited = limited or count > limit
    if limited:
        raise APIError(429, "RATE_LIMITED", "Please try again later")
