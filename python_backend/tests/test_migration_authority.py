import uuid
from pathlib import Path

import pytest
from sqlalchemy import UniqueConstraint, inspect, text

from app.migrations import BASELINE, HEAD, upgrade_connection
from app.models import Base
from app.schema_inventory import canonical_check, differences, reference_inventory, schema_inventory
from tools.migrate import adopt_baseline


@pytest.mark.asyncio
async def test_fresh_schema_matches_reference_and_declares_all_indexes_checks(postgres):
    async with postgres.kw["bind"].begin() as connection:
        actual = await schema_inventory(connection)
        assert differences(await reference_inventory(connection, HEAD), actual) == []

        def verify(sync):
            db = inspect(sync)
            for name, table in Base.metadata.tables.items():
                expected = {i.name for i in table.indexes} | {
                    c.name or name + "_" + "_".join(col.name for col in c.columns) + "_key"
                    for c in table.constraints
                    if isinstance(c, UniqueConstraint)
                }
                assert {i["name"] for i in db.get_indexes(name)} == expected, name
                assert {c["name"] for c in db.get_check_constraints(name)} == {
                    c.name for c in table.constraints if c.__class__.__name__ == "CheckConstraint"
                }, name

        await connection.run_sync(verify)


@pytest.mark.asyncio
async def test_adopt_populated_baseline_and_upgrade_without_reapplying_opening(postgres):
    schema = "adopt_test_" + uuid.uuid4().hex
    async with postgres.kw["bind"].begin() as connection:
        original = await connection.scalar(text("SELECT current_schema()"))
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        await connection.run_sync(upgrade_connection, BASELINE)
        user_id = uuid.uuid4()
        await connection.execute(
            text("INSERT INTO users(id,referral_code) VALUES(:id,'adopt-example')"), {"id": user_id}
        )
        await connection.execute(
            text("INSERT INTO wallets(user_id,balance,total_earned) VALUES(:id,0,0)"),
            {"id": user_id},
        )
        await connection.execute(text("DROP TABLE alembic_version"))
        opening_count = await connection.scalar(
            text("SELECT count(*) FROM wallet_movements WHERE kind='opening'")
        )
        before = await schema_inventory(connection)
        await adopt_baseline(connection)
        assert await connection.scalar(text("SELECT version_num FROM alembic_version")) == BASELINE
        assert await schema_inventory(connection) == before
        await connection.run_sync(upgrade_connection)
        assert await connection.scalar(text("SELECT count(*) FROM users")) == 1
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM wallet_movements WHERE kind='opening'")
            )
            == opening_count
        )
        assert await connection.scalar(text("SELECT version_num FROM alembic_version")) == HEAD
        await connection.execute(text(f'SET LOCAL search_path TO "{original}"'))
        await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@pytest.mark.asyncio
async def test_adoption_refuses_structural_drift_without_stamping(postgres):
    schema = "drift_test_" + uuid.uuid4().hex
    async with postgres.kw["bind"].begin() as connection:
        original = await connection.scalar(text("SELECT current_schema()"))
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        await connection.run_sync(upgrade_connection, BASELINE)
        await connection.execute(text("DROP TABLE alembic_version"))
        await connection.execute(text("DROP INDEX users_parent_id_idx"))
        with pytest.raises(ValueError, match="Baseline structure mismatch"):
            await adopt_baseline(connection)
        assert await connection.scalar(text("SELECT to_regclass('alembic_version')")) is None
        await connection.execute(text(f'SET LOCAL search_path TO "{original}"'))
        await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def test_frozen_baseline_files_have_no_new_prisma_authority():
    path = Path(__file__).parents[1] / "migrations/sql"
    assert len(list(path.glob("2026*.sql"))) == 6


def test_dump_cast_normalization_does_not_hide_changed_allowed_values():
    original = "CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'agent'::character varying])::text[])))"
    restored = "CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('agent'::character varying)::text])))"
    assert canonical_check(original) == canonical_check(restored)
    assert canonical_check(original) != canonical_check(restored.replace("'admin'", "'owner'"))


@pytest.mark.asyncio
async def test_frozen_sql_does_not_commit_outside_alembic_transaction(postgres):
    engine = postgres.kw["bind"]
    schema = "rollback_test_" + uuid.uuid4().hex
    async with engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    with pytest.raises(RuntimeError, match="simulated deployment failure"):
        async with engine.begin() as connection:
            await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            await connection.run_sync(upgrade_connection)
            raise RuntimeError("simulated deployment failure")
    async with engine.begin() as connection:
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM information_schema.tables WHERE table_schema=:schema"),
                {"schema": schema},
            )
            == 0
        )
        await connection.execute(text(f'DROP SCHEMA "{schema}"'))
