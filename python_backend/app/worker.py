"""Run separately from API workers: python -m app.worker. No external transfers."""

import asyncio
import logging
import signal
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from .config import Settings
from .db import make_session_factory
from .models import AuthRateLimit, PaymentInbox
from .payments import retry_payment_inbox
from .reconciliation import reconcile

logger = logging.getLogger("commission.worker")


async def run():
    factory, engine = make_session_factory(Settings.from_env().database_url)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    next_audit = 0
    try:
        while not stopped.is_set():
            try:
                batch = await retry_payment_inbox(factory)
                logger.info(
                    "payment_recovery attempted=%s failed=%s", batch["attempted"], batch["failed"]
                )
                if time.monotonic() >= next_audit:
                    issues = await reconcile(factory)
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
                                    PaymentInbox.created_at
                                    < datetime.now(timezone.utc) - timedelta(minutes=5),
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
                    next_audit = time.monotonic() + 300
            except Exception as exc:
                logger.error("recovery_cycle_failed error_type=%s", type(exc).__name__)
            try:
                await asyncio.wait_for(stopped.wait(), timeout=30)
            except TimeoutError:
                pass
    finally:
        await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run())
