from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def engine_options(database_url: str) -> tuple[object, dict]:
    """Translate Prisma/libpq options rather than passing them into asyncpg."""
    url = make_url(database_url)
    query = dict(url.query)
    schema = query.pop("schema", "public")
    if not isinstance(schema, str) or not schema.replace("_", "a").isalnum():
        raise ValueError("Database schema must be a simple identifier")
    connect_args = {"server_settings": {"search_path": f'"{schema}"'}}
    mode = query.pop("sslmode", query.pop("ssl", None))
    if mode is not None:
        if mode not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise ValueError("Unsupported database SSL mode")
        # asyncpg supports libpq mode strings, including hostname verification.
        connect_args["ssl"] = mode
    options = {"pool_pre_ping": True, "connect_args": connect_args}
    for source, target in (("connection_limit", "pool_size"), ("pool_timeout", "pool_timeout")):
        if source in query:
            value = int(query.pop(source))
            if value < 1:
                raise ValueError(f"{source} must be positive")
            options[target] = value
    if "pool_size" in options:
        options["max_overflow"] = 0
    if "connect_timeout" in query:
        timeout = float(query.pop("connect_timeout"))
        if not 0 < timeout < 3600:
            raise ValueError("connect_timeout must be positive and less than 3600 seconds")
        connect_args["timeout"] = timeout
    if query:
        raise ValueError("Unsupported database URL options: " + ", ".join(sorted(query)))
    return url.set(drivername="postgresql+asyncpg", query={}), options


def make_session_factory(database_url: str) -> tuple[async_sessionmaker[AsyncSession], object]:
    url, options = engine_options(database_url)
    engine = create_async_engine(url, **options)
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False), engine


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


async def begin_read_snapshot(session: AsyncSession):
    if not session.in_transaction():
        await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
