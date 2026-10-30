import asyncio
import os

from alembic import context

from app.db import make_session_factory
from app.models import Base

config = context.config


def migrate(connection):
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        compare_type=True,
        include_schemas=False,
    )
    with context.begin_transaction():
        context.run_migrations()


async def online():
    _, engine = make_session_factory(os.environ["DATABASE_URL"])
    try:
        async with engine.begin() as connection:
            await connection.run_sync(migrate)
    finally:
        await engine.dispose()


if config.attributes.get("connection") is not None:
    migrate(config.attributes["connection"])
elif context.is_offline_mode():
    context.configure(url="postgresql://", target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
