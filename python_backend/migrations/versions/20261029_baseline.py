"""Frozen, complete PostgreSQL baseline from the retired Prisma migration chain."""

from app.migrations import execute_sql

revision = "20261029_baseline"
down_revision = None


def upgrade():
    for name in (
        "20260922000000_init.sql",
        "20260922010000_platform_commission_ledger.sql",
        "20260923000000_dual_portal_identity.sql",
        "20261003000000_financial_lifecycle.sql",
        "20261003010000_second_review_fixes.sql",
    ):
        execute_sql(name)


def downgrade():
    raise RuntimeError(
        "Financial baseline is irreversible; use a verified restore or forward repair"
    )
