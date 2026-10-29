import os
from contextlib import asynccontextmanager

import pytest

from tools.test_database import temporary_database


@asynccontextmanager
async def disposable_postgres():
    if not os.getenv("TEST_DATABASE_URL"):
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test")
    async with temporary_database() as factory:
        yield factory
