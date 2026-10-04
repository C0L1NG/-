import uuid
from decimal import Decimal

from sqlalchemy import func, select, text

from .errors import APIError
from .models import PayoutAccount, Withdrawal, WithdrawalAction
from .wallets import lock_account, move_account


async def request_withdrawal(
    owner: uuid.UUID,
    scope: str,
    amount: Decimal,
    account_id: uuid.UUID,
    idempotency_key: str,
    session_factory,
) -> Withdrawal:
    async with session_factory() as session:
        async with session.begin():
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
                {"key": f"withdrawal:{owner}:{idempotency_key}"},
            )
            previous = await session.scalar(
                select(Withdrawal).where(
                    Withdrawal.user_id == owner, Withdrawal.idempotency_key == idempotency_key
                )
            )
            if previous:
                if (previous.amount, previous.account_id, previous.account_scope) != (
                    amount,
                    account_id,
                    scope,
                ):
                    raise APIError(409, "IDEMPOTENCY_CONFLICT")
                return previous
            account = await session.scalar(
                select(PayoutAccount).where(
                    PayoutAccount.id == account_id, PayoutAccount.user_id == owner
                )
            )
            if not account or not account.verified:
                raise APIError(409, "VERIFIED_PAYOUT_ACCOUNT_REQUIRED")
            withdrawal = Withdrawal(
                id=uuid.uuid4(),
                user_id=owner,
                account_scope=scope,
                amount=amount,
                account_id=account_id,
                idempotency_key=idempotency_key,
            )
            session.add(withdrawal)
            await move_account(
                session,
                owner if scope == "agent" else None,
                str(withdrawal.id),
                "withdrawal_hold",
                amount,
            )
            await session.flush()
            return withdrawal


async def review_withdrawal(
    withdrawal_id: uuid.UUID,
    admin_id: uuid.UUID,
    action: str,
    reference: str | None,
    session_factory,
    *,
    reason: str | None = None,
    failure_reference: str | None = None,
    expected_version: int | None = None,
) -> Withdrawal:
    async with session_factory() as session:
        async with session.begin():
            item = (
                await session.scalars(
                    select(Withdrawal).where(Withdrawal.id == withdrawal_id).with_for_update()
                )
            ).one_or_none()
            if not item:
                raise APIError(404, "WITHDRAWAL_NOT_FOUND")
            target = {"start": "processing", "confirm": "paid", "reject": "rejected"}[action]
            # Preserve old clients: rejected transferReference was a reason/failure receipt.
            rejection_reason = reason or reference if action == "reject" else None
            failure = failure_reference or (
                reference if action == "reject" and item.claimed_by else None
            )
            if item.status == target:
                if (item.claimed_by or item.reviewed_by) != admin_id:
                    raise APIError(409, "WITHDRAWAL_CLAIMED_BY_ANOTHER_ADMIN")
                if target == "paid" and item.payout_reference != reference:
                    raise APIError(409, "PAYOUT_REFERENCE_CONFLICT")
                if target == "rejected" and (item.rejection_reason, item.failure_reference) != (
                    rejection_reason,
                    failure,
                ):
                    raise APIError(409, "REJECTION_CONTENT_CONFLICT")
                return item
            if expected_version is not None and expected_version != item.version:
                raise APIError(409, "WITHDRAWAL_VERSION_CONFLICT")
            if item.status == "processing" and item.claimed_by != admin_id:
                raise APIError(409, "WITHDRAWAL_CLAIMED_BY_ANOTHER_ADMIN")
            if action == "start":
                if item.status != "pending":
                    raise APIError(409, "INVALID_WITHDRAWAL_STATE")
                account = await lock_account(
                    session, item.user_id if item.account_scope == "agent" else None
                )
                if account.debt_balance > 0:
                    raise APIError(409, "REFUND_DEBT_BLOCKS_PAYOUT")
                if account.frozen_balance < item.amount:
                    raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
                item.claimed_by = admin_id
            if action == "confirm" and (item.status != "processing" or not reference):
                raise APIError(409, "VERIFIED_TRANSFER_REFERENCE_REQUIRED")
            if action == "reject":
                if item.status not in {"pending", "processing"}:
                    raise APIError(409, "INVALID_WITHDRAWAL_STATE")
                if item.status == "processing" and not failure:
                    raise APIError(409, "TRANSFER_FAILURE_REFERENCE_REQUIRED")
                if not rejection_reason:
                    raise APIError(400, "REJECTION_REASON_REQUIRED")
            if action != "start":
                # A refund during processing cannot erase a real channel payment.
                # Record the known channel outcome; debt remains visible for recovery.
                await move_account(
                    session,
                    item.user_id if item.account_scope == "agent" else None,
                    str(item.id),
                    "withdrawal_paid" if action == "confirm" else "withdrawal_release",
                    item.amount,
                )
            previous_status = item.status
            item.status, item.reviewed_by = target, admin_id
            item.payout_reference = reference if action == "confirm" else None
            item.rejection_reason = rejection_reason
            item.failure_reference = failure
            item.version += 1
            item.updated_at = func.now()
            session.add(
                WithdrawalAction(
                    withdrawal_id=item.id,
                    actor_id=admin_id,
                    action=action,
                    from_status=previous_status,
                    to_status=target,
                    version=item.version,
                    reference=reference if action == "confirm" else failure,
                    reason=rejection_reason,
                )
            )
            await session.flush()
            return item
