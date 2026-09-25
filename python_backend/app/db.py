from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def make_session_factory(database_url: str) -> tuple[async_sessionmaker[AsyncSession], object]:
    url = make_url(database_url)
    schema = url.query.get("schema")
    url = url.set(drivername="postgresql+asyncpg", query={k: v for k, v in url.query.items() if k != "schema"})
    connect_args = {"server_settings": {"search_path": schema}} if schema and schema != "public" else {}
    engine = create_async_engine(url, pool_pre_ping=True, connect_args=connect_args)
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False), engine


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session
