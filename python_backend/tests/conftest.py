import pytest_asyncio
from postgres_support import disposable_postgres


@pytest_asyncio.fixture
async def postgres():
    async with disposable_postgres() as factory:
        yield factory
