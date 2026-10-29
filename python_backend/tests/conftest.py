import pytest_asyncio
from postgres_support import disposable_postgres


@pytest_asyncio.fixture
async def postgres():
    async with disposable_postgres() as factory:
        yield factory


def pytest_addoption(parser):
    parser.addoption(
        "--require-database",
        action="store_true",
        help="Require TEST_DATABASE_URL and reject skipped tests",
    )


def pytest_sessionstart(session):
    import os

    import pytest

    if session.config.getoption("--require-database") and not os.getenv("TEST_DATABASE_URL"):
        raise pytest.UsageError("Full verification requires a disposable TEST_DATABASE_URL")


def pytest_sessionfinish(session, exitstatus):
    import pytest

    if session.config.getoption("--require-database"):
        reporter = session.config.pluginmanager.getplugin("terminalreporter")
        if reporter and reporter.stats.get("skipped"):
            session.exitstatus = pytest.ExitCode.TESTS_FAILED
