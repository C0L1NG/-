"""Disposable schemas for integration checks. Refuses non-test database names."""

import os
import uuid
from contextlib import asynccontextmanager

import asyncpg
from sqlalchemy.engine import make_url

from app.db import make_session_factory
from app.migrations import upgrade_connection


@asynccontextmanager
async def temporary_database():
    url = make_url(os.environ["TEST_DATABASE_URL"])
    if not (url.database or "").endswith("_test"):
        raise ValueError("TEST_DATABASE_URL must name a disposable database ending in _test")
    clean = url.set(drivername="postgresql", query={})
    schema = "commission_test_" + uuid.uuid4().hex[:12]
    admin = await asyncpg.connect(dsn=clean.render_as_string(hide_password=False))
    engine = None
    try:
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        factory, engine = make_session_factory(
            clean.set(query={"schema": schema}).render_as_string(hide_password=False)
        )
        async with engine.begin() as connection:
            await connection.run_sync(upgrade_connection)
        yield factory
    finally:
        if engine is not None:
            await engine.dispose()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()
