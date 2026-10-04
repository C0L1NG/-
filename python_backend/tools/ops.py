"""Operational commands: bootstrap identity, retry pending settlement and reconcile."""

import argparse
import asyncio
import getpass
import sys
import time
from pathlib import Path

from sqlalchemy import delete, func, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.commission import process_order_commission
from app.config import Settings
from app.db import make_session_factory
from app.models import (
    AuthRateLimit,
    Order,
    PaymentStatus,
    SettlementStatus,
    User,
    UserRole,
    WebLoginTicket,
)
from app.security import hash_password


async def run(args):
    factory, engine = make_session_factory(Settings.from_env().database_url)
    try:
        if args.command == "bootstrap-admin":
            password = getpass.getpass("Admin password (12+ characters): ")
            if password != getpass.getpass("Repeat password: "):
                raise ValueError("Passwords differ")
            hashed = hash_password(password)
            async with factory() as session:
                async with session.begin():
                    user = await session.scalar(
                        select(User).where(User.login_name == args.username).with_for_update()
                    )
                    if user:
                        raise ValueError("Admin already exists; use rotate-password")
                    session.add(
                        User(
                            role=UserRole.ADMIN,
                            login_name=args.username,
                            password_hash=hashed,
                            display_name=args.username,
                            wechat_open_id=args.wechat_open_id,
                        )
                    )
            print("Admin created")
        elif args.command == "rotate-password":
            hashed = hash_password(getpass.getpass("New password (12+ characters): "))
            async with factory() as session:
                async with session.begin():
                    user = await session.scalar(
                        select(User)
                        .where(User.login_name == args.username, User.role == UserRole.ADMIN)
                        .with_for_update()
                    )
                    if not user:
                        raise ValueError("Admin not found")
                    user.password_hash, user.token_version = hashed, user.token_version + 1
            print("Password changed; existing sessions revoked")
        elif args.command == "account-status":
            import uuid

            async with factory() as session:
                async with session.begin():
                    user = await session.scalar(
                        select(User).where(User.id == uuid.UUID(args.user_id)).with_for_update()
                    )
                    if not user:
                        raise ValueError("Account not found")
                    user.is_active = args.active == "true"
                    user.token_version += 1
            print("Account status updated; existing sessions revoked")
        elif args.command == "retry-settlements":
            async with factory() as session:
                ids = (
                    await session.scalars(
                        select(Order.id)
                        .where(
                            Order.payment_status == PaymentStatus.PAID,
                            Order.settlement_status == SettlementStatus.PENDING,
                        )
                        .order_by(Order.paid_at, Order.id)
                        .limit(args.limit)
                    )
                ).all()
            failures = 0
            for order_id in ids:
                try:
                    result = await process_order_commission(str(order_id), factory)
                    print(order_id, result["status"])
                except Exception as exc:
                    failures += 1
                    print(order_id, type(exc).__name__, file=sys.stderr)
            return 1 if failures else 0
        elif args.command == "retry-payment-events":
            from app.payments import retry_payment_inbox

            result = await retry_payment_inbox(factory, args.limit)
            print(f"Payment events attempted: {result['attempted']}; failures: {result['failed']}")
            return 1 if result["failed"] else 0
        elif args.command == "reconcile":
            from app.reconciliation import reconcile

            mismatches = await reconcile(factory)
            for item in mismatches:
                print(item)
            print(f"Reconciliation mismatches: {len(mismatches)}")
            return 1 if mismatches else 0
        elif args.command == "cleanup-tickets":
            async with factory() as session:
                async with session.begin():
                    await session.execute(
                        delete(WebLoginTicket).where(WebLoginTicket.expires_at < func.now())
                    )
                    await session.execute(
                        delete(AuthRateLimit).where(
                            AuthRateLimit.window_start < time.time() // 60 - 2
                        )
                    )
            print("Expired login tickets and auth counters removed")
    finally:
        await engine.dispose()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("bootstrap-admin")
    admin.add_argument("--username", required=True)
    admin.add_argument("--wechat-open-id")
    rotate = sub.add_parser("rotate-password")
    rotate.add_argument("--username", required=True)
    retry = sub.add_parser("retry-settlements")
    retry.add_argument("--limit", type=int, default=100)
    recover = sub.add_parser("retry-payment-events")
    recover.add_argument("--limit", type=int, default=100)
    status = sub.add_parser("account-status")
    status.add_argument("--user-id", required=True)
    status.add_argument("--active", choices=["true", "false"], required=True)
    sub.add_parser("reconcile")
    sub.add_parser("cleanup-tickets")
    raise SystemExit(asyncio.run(run(parser.parse_args())))
