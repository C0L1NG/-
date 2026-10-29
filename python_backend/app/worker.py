"""Run separately from API workers: python -m app.worker. No external transfers."""

import asyncio
import logging
import signal
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from .config import Settings
from .db import make_session_factory
from .diagnostics import safe_trace
from .models import AuthRateLimit, PaymentInbox
from .operations import persist_reconciliation, record_worker_health
from .payments import retry_payment_inbox
from .reconciliation import reconcile

logger = logging.getLogger("commission.worker")


async def run():
    factory, engine = make_session_factory(Settings.from_env().database_url)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)

    async def recovery():
        batch = await retry_payment_inbox(factory)
        logger.info("payment_recovery attempted=%s failed=%s", batch["attempted"], batch["failed"])

    async def audit():
        observed_at, issues = await reconcile(factory, with_observed_at=True)
        await persist_reconciliation(factory, issues, observed_at)
        async with factory() as session:
            async with session.begin():
                await session.execute(
                    delete(AuthRateLimit).where(
                        AuthRateLimit.window_start < int(time.time() / 60) - 2
                    )
                )
                delayed = await session.scalar(
                    select(func.count())
                    .select_from(PaymentInbox)
                    .where(
                        PaymentInbox.status != "processed",
                        PaymentInbox.created_at < datetime.now(timezone.utc) - timedelta(minutes=5),
                    )
                )
        if issues or delayed:
            logger.error(
                "financial_attention reconciliation_issues=%s delayed_payment_events=%s",
                len(issues),
                delayed,
            )
        else:
            logger.info("financial_reconciliation ok")

    async def schedule(name, action, interval):
        while not stopped.is_set():
            error = None
            try:
                await action()
            except Exception as exc:
                error = type(exc).__name__
                logger.error(
                    "worker_cycle_failed name=%s error_type=%s frames=%s",
                    name,
                    error,
                    safe_trace(exc),
                )
            try:
                await record_worker_health(factory, name, error)
            except Exception as exc:
                logger.error("worker_health_failed name=%s error_type=%s", name, type(exc).__name__)
            try:
                await asyncio.wait_for(stopped.wait(), timeout=interval)
            except TimeoutError:
                pass

    try:
        await asyncio.gather(
            schedule("payment-recovery", recovery, 30), schedule("financial-audit", audit, 300)
        )

    finally:
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
