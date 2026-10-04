"""Paginated nodes with server-side whole-team totals; children load on demand."""

from sqlalchemy import func, or_, select

from ..commission import money
from ..models import (
    User,
    UserRole,
    Wallet,
)
from .performance import promoter_performance


async def network_page(session, parent_id, page, page_size, window, query):
    filters = [
        User.role == UserRole.AGENT,
        User.parent_id == parent_id if parent_id else User.parent_id.is_(None),
    ]
    if query:
        escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(
            or_(
                User.display_name.ilike(f"%{escaped}%", escape="\\"),
                User.referral_code.ilike(f"%{escaped}%", escape="\\"),
            )
        )
    performance, platform_performance, mentor_performance = promoter_performance(window)
    team_key = func.coalesce(User.parent_id, User.id)
    team_gmv = (
        select(team_key.label("owner"), func.sum(performance.c.amount).label("gmv"))
        .join(performance, performance.c.owner == User.id)
        .group_by(team_key)
        .subquery()
    )
    team_platform = (
        select(team_key.label("owner"), func.sum(platform_performance.c.amount).label("amount"))
        .join(platform_performance, platform_performance.c.owner == User.id)
        .group_by(team_key)
        .subquery()
    )
    base = (
        select(User, Wallet.balance, Wallet.total_earned, team_gmv.c.gmv, team_platform.c.amount)
        .outerjoin(Wallet, Wallet.user_id == User.id)
        .outerjoin(team_gmv, team_gmv.c.owner == User.id)
        .outerjoin(team_platform, team_platform.c.owner == User.id)
        .where(*filters)
    )
    total = await session.scalar(select(func.count()).select_from(User).where(*filters)) or 0
    order = (
        [func.coalesce(team_platform.c.amount, 0).desc(), User.id]
        if not parent_id
        else [User.created_at, User.id]
    )
    rows = (
        await session.execute(base.order_by(*order).offset((page - 1) * page_size).limit(page_size))
    ).all()
    ids = [user.id for user, *_ in rows]
    if not ids:
        return {"items": [], "page": page, "pageSize": page_size, "total": total, "totalPages": 0}
    orders = {
        owner: (gmv, count)
        for owner, gmv, count in (
            await session.execute(select(performance).where(performance.c.owner.in_(ids)))
        ).all()
    }
    platform = dict(
        (
            await session.execute(
                select(platform_performance).where(platform_performance.c.owner.in_(ids))
            )
        ).all()
    )
    mentor = dict(
        (
            await session.execute(
                select(mentor_performance).where(mentor_performance.c.owner.in_(ids))
            )
        ).all()
    )
    sizes = dict(
        (
            await session.execute(
                select(User.parent_id, func.count())
                .where(User.parent_id.in_(ids))
                .group_by(User.parent_id)
            )
        ).all()
    )
    return {
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": (total + page_size - 1) // page_size,
        "items": [
            {
                "id": str(user.id),
                "displayName": user.display_name or "未命名代理",
                "referralCode": user.referral_code,
                "balance": money(balance),
                "totalEarned": money(earned),
                "ownGmv": money(orders.get(user.id, (0, 0))[0]),
                "ownOrderCount": orders.get(user.id, (0, 0))[1],
                "platformContribution": money(platform.get(user.id)),
                "mentorPaidUp": money(mentor.get(user.id)),
                "teamSize": sizes.get(user.id, 0),
                "children": [],
                "teamGmv": money(gmv if not parent_id else orders.get(user.id, (0, 0))[0]),
                "teamPlatformContribution": money(
                    contribution if not parent_id else platform.get(user.id)
                ),
            }
            for user, balance, earned, gmv, contribution in rows
        ],
    }
