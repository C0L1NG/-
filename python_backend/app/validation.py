import uuid

from fastapi import Depends, Request

from .errors import APIError
from .security import current_admin_id, current_agent_id

ALLOWED_QUERY: dict[str, set[str]] = {
    "/api/agent/overview": set(),
    "/api/agent/logout": set(),
    "/api/agent/referral": set(),
    "/api/agent/team": {"page", "pageSize"},
    "/api/agent/bind-parent": set(),
    "/api/agent/mini-program-code": set(),
    "/api/agent/ledger": {"page", "pageSize", "from", "to", "roleType"},
    "/api/admin/overview": {"period"},
    "/api/admin/team-tree": {"period"},
    "/api/admin/commission-audit": {"page", "pageSize", "period", "q"},
    "/api/auth/wechat/login": set(),
}


def validate_query(request: Request) -> None:
    allowed = ALLOWED_QUERY.get(request.url.path)
    if allowed is None and request.url.path.startswith("/api/admin/agents/"):
        allowed = set()
    if allowed is not None and any(key not in allowed for key in request.query_params):
        raise APIError(400, "FST_ERR_VALIDATION", "Unknown query parameter")


async def agent_query(request: Request, _agent: uuid.UUID = Depends(current_agent_id)) -> None:
    validate_query(request)


async def admin_query(request: Request, _admin: uuid.UUID = Depends(current_admin_id)) -> None:
    validate_query(request)


async def public_query(request: Request) -> None:
    validate_query(request)
