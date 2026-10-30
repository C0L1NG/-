import hashlib
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from .models import ReconciliationCase, WorkerHealth


async def record_worker_health(factory, name, error=None):
    now = datetime.now(timezone.utc)
    values = {"name": name, "last_error": error, "updated_at": now}
    if error is None:
        values["last_success_at"] = now
    async with factory() as session:
        async with session.begin():
            statement = insert(WorkerHealth).values(**values)
            await session.execute(
                statement.on_conflict_do_update(
                    index_elements=[WorkerHealth.name],
                    set_={key: value for key, value in values.items() if key != "name"},
                )
            )


async def persist_reconciliation(factory, issues, observed_at=None):
    now = datetime.now(timezone.utc)
    observed_at = observed_at or now
    active = {hashlib.sha256(detail.encode()).hexdigest(): detail for detail in issues}
    async with factory() as session:
        async with session.begin():
            # Serializes full audit results from multiple workers.
            from sqlalchemy import text

            await session.execute(text("SELECT pg_advisory_xact_lock(746312901)"))
            latest = await session.get(WorkerHealth, "reconciliation-snapshot")
            if latest and latest.last_success_at and latest.last_success_at >= observed_at:
                return False
            if latest is None:
                session.add(
                    WorkerHealth(name="reconciliation-snapshot", last_success_at=observed_at)
                )
            else:
                latest.last_success_at, latest.updated_at = observed_at, now
            rows = (await session.scalars(select(ReconciliationCase))).all()
            by_id = {item.id: item for item in rows}
            for key, detail in active.items():
                item = by_id.get(key)
                if item is None:
                    session.add(
                        ReconciliationCase(
                            id=key,
                            detail=detail,
                            first_seen_at=observed_at,
                            last_seen_at=observed_at,
                        )
                    )
                else:
                    item.last_seen_at = observed_at
                    if item.status == "resolved":
                        item.status, item.resolved_at, item.acknowledged_by = "open", None, None
            for item in rows:
                if item.id not in active and item.status != "resolved":
                    item.status, item.resolved_at = "resolved", observed_at
    return True


def health_state(item, max_age):
    if item is None or item.last_success_at is None:
        return "unavailable"
    if (
        item.last_error
        or (datetime.now(timezone.utc) - item.last_success_at).total_seconds() > max_age
    ):
        return "degraded"
    return "healthy"
