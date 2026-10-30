import uuid

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from ..db import get_session
from ..errors import APIError
from ..models import PaymentInbox, ReconciliationCase, WorkerHealth
from ..operations import health_state
from ..presentation import iso_utc
from ..security import current_admin_id

router = APIRouter(prefix="/api/admin", tags=["operations"])


class WorkerState(BaseModel):
    name: str
    state: str
    lastSuccessAt: str | None
    lastError: str | None


class SystemHealth(BaseModel):
    workers: list[WorkerState]
    unresolvedCases: int
    exhaustedPaymentEvents: int


class AuditCase(BaseModel):
    id: str
    detail: str
    status: str
    firstSeenAt: str
    lastSeenAt: str
    acknowledgedBy: str | None


class CasePage(BaseModel):
    items: list[AuditCase]
    total: int
    page: int
    pageSize: int


def case_json(item):
    return {
        "id": item.id,
        "detail": item.detail,
        "status": item.status,
        "firstSeenAt": iso_utc(item.first_seen_at),
        "lastSeenAt": iso_utc(item.last_seen_at),
        "acknowledgedBy": str(item.acknowledged_by) if item.acknowledged_by else None,
    }


@router.get("/system-health", response_model=SystemHealth)
async def system_health(
    _admin: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    rows = {item.name: item for item in (await session.scalars(select(WorkerHealth))).all()}
    return {
        "workers": [
            {
                "name": name,
                "state": health_state(rows.get(name), age),
                "lastSuccessAt": iso_utc(rows[name].last_success_at)
                if rows.get(name) and rows[name].last_success_at
                else None,
                "lastError": rows[name].last_error if name in rows else None,
            }
            for name, age in (("payment-recovery", 90), ("financial-audit", 900))
        ],
        "unresolvedCases": await session.scalar(
            select(func.count())
            .select_from(ReconciliationCase)
            .where(ReconciliationCase.status != "resolved")
        ),
        "exhaustedPaymentEvents": await session.scalar(
            select(func.count())
            .select_from(PaymentInbox)
            .where(PaymentInbox.status != "processed", PaymentInbox.attempts >= 20)
        ),
    }


@router.get("/reconciliation-cases", response_model=CasePage)
async def audit_cases(
    page: int = Query(1, ge=1, le=10000),
    pageSize: int = Query(20, ge=1, le=100),
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    condition = ReconciliationCase.status != "resolved"
    rows = (
        await session.scalars(
            select(ReconciliationCase)
            .where(condition)
            .order_by(ReconciliationCase.last_seen_at.desc(), ReconciliationCase.id)
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [case_json(item) for item in rows],
        "page": page,
        "pageSize": pageSize,
        "total": await session.scalar(
            select(func.count()).select_from(ReconciliationCase).where(condition)
        ),
    }


@router.post("/reconciliation-cases/{case_id}/acknowledge", response_model=AuditCase)
async def acknowledge(case_id: str, request: Request, admin: uuid.UUID = Depends(current_admin_id)):
    async with request.app.state.session_factory() as session:
        async with session.begin():
            item = await session.scalar(
                select(ReconciliationCase).where(ReconciliationCase.id == case_id).with_for_update()
            )
            if item is None:
                raise APIError(404, "RECONCILIATION_CASE_NOT_FOUND")
            if item.status == "acknowledged" and item.acknowledged_by != admin:
                raise APIError(409, "RECONCILIATION_CASE_ALREADY_CLAIMED")
            if item.status != "resolved":
                item.status, item.acknowledged_by = "acknowledged", admin
            return case_json(item)
