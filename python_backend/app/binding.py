import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .errors import APIError
from .models import User, UserRole


async def bind_direct_parent(
    agent_id: uuid.UUID, referral_code: str, session_factory: async_sessionmaker[AsyncSession]
) -> dict[str, str]:
    code = referral_code.strip()
    if not code or len(code) > 64:
        raise APIError(400, "INVALID_REFERRAL_CODE", "Invalid referral code")
    async with session_factory() as session:
        async with session.begin():
            return await bind_parent_in_session(session, agent_id, code)


async def bind_parent_in_session(session, agent_id: uuid.UUID, code: str) -> dict[str, str]:
    rows = (
        await session.scalars(
            select(User)
            .where(
                User.role == UserRole.AGENT, or_(User.id == agent_id, User.referral_code == code)
            )
            .order_by(User.id)
            .with_for_update()
        )
    ).all()
    current = next((row for row in rows if row.id == agent_id), None)
    parent = next((row for row in rows if row.referral_code == code), None)
    if current is None:
        raise APIError(401, "AGENT_NOT_FOUND", "Agent account not found")
    if parent is None:
        raise APIError(404, "REFERRAL_NOT_FOUND", "Referral code not found")
    if parent.is_active is False or current.is_active is False:
        raise APIError(409, "ACCOUNT_DISABLED")
    if parent.id == current.id:
        raise APIError(409, "SELF_REFERRAL", "An agent cannot bind to themselves")
    if current.parent_id:
        if current.parent_id == parent.id:
            return {"status": "already_bound", "parentId": str(parent.id)}
        raise APIError(409, "PARENT_ALREADY_BOUND", "Parent binding cannot be changed")
    if parent.parent_id:
        raise APIError(409, "THIRD_LEVEL_FORBIDDEN", "Only root agents can invite direct agents")
    child_count = await session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.parent_id == current.id, User.role == UserRole.AGENT)
    )
    if child_count:
        raise APIError(
            409, "AGENT_HAS_TEAM", "An agent with a team cannot become a second-level agent"
        )
    changed = await session.scalar(
        update(User)
        .where(User.id == current.id, User.role == UserRole.AGENT, User.parent_id.is_(None))
        .values(
            parent_id=parent.id, parent_bound_at=datetime.now(timezone.utc), updated_at=func.now()
        )
        .returning(User.id)
    )
    if changed is None:
        raise APIError(409, "BINDING_CONFLICT", "Parent binding changed concurrently")
    return {"status": "bound", "parentId": str(parent.id)}
