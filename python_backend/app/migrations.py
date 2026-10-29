"""One migration authority. Safe to call on an existing async SQLAlchemy transaction."""

import re
from pathlib import Path

from alembic import command
from alembic.config import Config

BASELINE = "20261029_baseline"
HEAD = "20261029_hardening"


def configuration():
    return Config(str(Path(__file__).parents[1] / "alembic.ini"))


def upgrade_connection(connection, revision="head"):
    config = configuration()
    config.attributes["connection"] = connection
    command.upgrade(config, revision)


def execute_sql(name):
    from alembic import context, op

    source = (Path(__file__).parents[1] / "migrations/sql" / name).read_text()
    # Prisma files own BEGIN/COMMIT; Alembic must own the encompassing transaction.
    # Strip only file-level wrappers, preserving BEGIN inside PL/pgSQL functions.
    source = re.sub(r"\ABEGIN;\s*", "", source, flags=re.I)
    source = re.sub(r"\s*COMMIT;\s*\Z", "", source, flags=re.I)
    if context.is_offline_mode():
        op.execute(source)
    else:
        # Preserve multi-statement SQL and dollar-quoted PostgreSQL functions.
        op.get_bind().connection.dbapi_connection.run_async(lambda raw: raw.execute(source))
