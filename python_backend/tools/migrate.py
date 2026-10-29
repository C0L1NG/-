"""Python-owned migrations: upgrade, check, or safely adopt a Prisma-era database."""

import argparse
import asyncio
import hashlib
import os
import sys
from pathlib import Path

from alembic import command
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.db import make_session_factory  # noqa: E402
from app.migrations import BASELINE, HEAD, configuration, upgrade_connection  # noqa: E402
from app.schema_inventory import differences, reference_inventory, schema_inventory  # noqa: E402


async def adopt_baseline(connection):
    if await connection.scalar(text("SELECT to_regclass('alembic_version')")):
        raise ValueError("Already managed by Alembic; run upgrade/check")
    actual = await schema_inventory(connection)
    expected = await reference_inventory(connection, BASELINE)
    drift = differences(expected, actual)
    if drift:
        raise ValueError("Baseline structure mismatch: " + ", ".join(drift))
    if await connection.scalar(text("SELECT to_regclass('_prisma_migrations')")):
        rows = (
            (
                await connection.execute(
                    text(
                        'SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"'
                    )
                )
            )
            .mappings()
            .all()
        )
        for path in sorted((ROOT / "migrations/sql").glob("2026*_*.sql")):
            if path.name == "20261029_hardening.sql":
                continue
            matches = [
                row
                for row in rows
                if row["migration_name"] == path.stem
                and row["finished_at"]
                and not row["rolled_back_at"]
            ]
            if (
                len(matches) != 1
                or matches[0]["checksum"] != hashlib.sha256(path.read_bytes()).hexdigest()
            ):
                raise ValueError("Prisma history mismatch: " + path.stem)

    def stamp(sync_connection):
        config = configuration()
        config.attributes["connection"] = sync_connection
        command.stamp(config, BASELINE)

    await connection.run_sync(stamp)


async def run(action):
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT.parent / ".env")
    _, engine = make_session_factory(
        os.getenv("MIGRATION_DATABASE_URL") or os.environ["DATABASE_URL"]
    )
    try:
        async with engine.begin() as connection:
            await connection.execute(text("SELECT pg_advisory_xact_lock(746312900)"))
            if action == "adopt-prisma":
                await adopt_baseline(connection)
            elif action == "upgrade":
                if not await connection.scalar(
                    text("SELECT to_regclass('alembic_version')")
                ) and await connection.scalar(text("SELECT to_regclass('users')")):
                    raise ValueError(
                        "Existing unversioned database: verify backup and run adopt-prisma first"
                    )
                await connection.run_sync(upgrade_connection)
                actual = await schema_inventory(connection)
                drift = differences(await reference_inventory(connection, HEAD), actual)
                if drift:
                    raise ValueError("Post-upgrade schema drift: " + ", ".join(drift))
            else:
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
                if version != HEAD:
                    raise ValueError("Migration required")
                actual = await schema_inventory(connection)
                drift = differences(await reference_inventory(connection, HEAD), actual)
                if drift:
                    raise ValueError("Schema drift: " + ", ".join(drift))
    finally:
        await engine.dispose()
    print(f"Migration {action}: verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["upgrade", "check", "adopt-prisma"])
    args = parser.parse_args()
    try:
        asyncio.run(run(args.action))
    except Exception as error:
        # Do not print the database URL or SQL parameters.
        print(
            str(error) if isinstance(error, ValueError) else type(error).__name__, file=sys.stderr
        )
        raise SystemExit(1)
