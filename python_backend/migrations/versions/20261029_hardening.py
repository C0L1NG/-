"""Refund holds, versioned payout accounts, worker health and audit cases."""

from app.migrations import execute_sql

revision = "20261029_hardening"
down_revision = "20261029_baseline"


def upgrade():
    execute_sql("20261029_hardening.sql")


def downgrade():
    raise RuntimeError("Do not discard financial evidence; deploy a forward repair")
