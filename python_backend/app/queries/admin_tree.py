"""The complete two-level admin hierarchy read model."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..commission import money
from ..models import (
    User,
    UserRole,
    Wallet,
)
from .performance import promoter_performance


async def load_admin_tree(
    session: AsyncSession, admin_id: uuid.UUID, window: tuple[datetime, datetime] | None
) -> dict:
    admin = await session.get(User, admin_id)
    agents = (
        await session.execute(
            select(User, Wallet.balance, Wallet.total_earned)
            .outerjoin(Wallet, Wallet.user_id == User.id)
            .where(User.role == UserRole.AGENT)
            .order_by(User.created_at, User.id)
        )
    ).all()
    performance, platform_performance, mentor_performance = promoter_performance(window)
    order_totals = {
        owner: (gmv, count)
        for owner, gmv, count in (await session.execute(select(performance))).all()
    }
    platform_totals = dict((await session.execute(select(platform_performance))).all())
    mentor_totals = dict((await session.execute(select(mentor_performance))).all())
    nodes = {
        agent.id: {
            "id": str(agent.id),
            "displayName": agent.display_name if agent.display_name is not None else "未命名代理",
            "referralCode": agent.referral_code,
            "balance": money(balance),
            "totalEarned": money(earned),
            "ownGmv": money(order_totals.get(agent.id, (None, 0))[0]),
            "ownOrderCount": order_totals.get(agent.id, (None, 0))[1],
            "platformContribution": money(platform_totals.get(agent.id)),
            "mentorPaidUp": money(mentor_totals.get(agent.id)),
            "teamSize": 0,
            "children": [],
        }
        for agent, balance, earned in agents
    }
    roots = []
    for agent, _, _ in agents:
        node = nodes[agent.id]
        if agent.parent_id and agent.parent_id in nodes:
            parent = nodes[agent.parent_id]
            parent["children"].append(node)
            parent["teamSize"] += 1
        else:
            roots.append(node)
    return {
        "root": {
            "id": str(admin_id),
            "type": "ADMIN",
            "displayName": admin.display_name
            if admin and admin.display_name is not None
            else "老板总控",
            "children": roots,
        }
    }
