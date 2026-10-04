import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.db import make_session_factory

MIGRATIONS = Path(__file__).resolve().parents[2] / "prisma/migrations"


@asynccontextmanager
async def disposable_postgres():
    raw_url = os.getenv("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test")
    url = make_url(raw_url)
    if not (url.database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL database name must end in _test")
    clean_url = url.set(drivername="postgresql", query={})
    schema = "commission_test_" + uuid.uuid4().hex[:12]
    admin = await asyncpg.connect(dsn=clean_url.render_as_string(hide_password=False))
    factory = engine = None
    try:
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        await admin.execute(f'SET search_path TO "{schema}"')
        for migration in sorted(MIGRATIONS.glob("*/migration.sql")):
            await admin.execute(migration.read_text())
        factory, engine = make_session_factory(
            clean_url.set(query={"schema": schema}).render_as_string(hide_password=False)
        )
        yield factory
    finally:
        if engine is not None:
            await engine.dispose()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()
