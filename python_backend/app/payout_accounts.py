"""Versioned account identities. Existing withdrawals retain their original account."""

from sqlalchemy import select, update

from .errors import APIError
from .models import PayoutAccount, User


async def save_payout_account(owner, provider, vault_reference, label, session_factory):
    async with session_factory() as session:
        async with session.begin():
            user = await session.scalar(select(User).where(User.id == owner).with_for_update())
            if provider == "wechat":
                if not user.wechat_open_id:
                    raise APIError(409, "WECHAT_IDENTITY_REQUIRED")
                reference, verified, label = user.wechat_open_id, True, "本人微信零钱"
            else:
                if not vault_reference:
                    raise APIError(
                        400,
                        "BANK_VAULT_REFERENCE_REQUIRED",
                        "Use a verified payment vault reference",
                    )
                reference, verified = vault_reference, False
            active = await session.scalar(
                select(PayoutAccount).where(
                    PayoutAccount.user_id == owner,
                    PayoutAccount.provider == provider,
                    PayoutAccount.status == "active",
                )
            )
            if active and active.account_reference == reference:
                return active
            pending = await session.scalar(
                select(PayoutAccount).where(
                    PayoutAccount.user_id == owner,
                    PayoutAccount.provider == provider,
                    PayoutAccount.account_reference == reference,
                    PayoutAccount.status == "pending",
                )
            )
            if pending:
                return pending
            account = PayoutAccount(
                user_id=owner,
                provider=provider,
                account_reference=reference,
                label=label,
                verified=verified,
                status="active" if verified else "pending",
                replaces_id=active.id if active else None,
            )
            if verified and active:
                active.status = "retired"
                await session.flush()
            session.add(account)
            await session.flush()
            return account


async def decide_payout_account(account_id, admin, reference, session_factory, *, rejection=None):
    async with session_factory() as session:
        async with session.begin():
            item = await session.get(PayoutAccount, account_id)
            if item is None:
                raise APIError(404, "PAYOUT_ACCOUNT_NOT_FOUND")
            # All account creation/decisions serialize on the owner, then account.
            await session.scalar(select(User).where(User.id == item.user_id).with_for_update())
            account = await session.scalar(
                select(PayoutAccount)
                .where(PayoutAccount.id == account_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if account.status == "active" and not rejection:
                if account.verification_reference and account.verification_reference != reference:
                    raise APIError(409, "VERIFICATION_REFERENCE_CONFLICT")
                return account
            if account.status == "rejected" and rejection == account.rejection_reason:
                return account
            if account.status != "pending":
                raise APIError(409, "PAYOUT_ACCOUNT_NOT_PENDING")
            if rejection:
                account.status, account.rejection_reason = "rejected", rejection
                account.verified_by = admin
                return account
            active = await session.scalar(
                select(PayoutAccount).where(
                    PayoutAccount.user_id == account.user_id,
                    PayoutAccount.provider == account.provider,
                    PayoutAccount.status == "active",
                )
            )
            if (active.id if active else None) != account.replaces_id:
                raise APIError(409, "PAYOUT_ACCOUNT_CHANGED_RETRY")
            await session.execute(
                update(PayoutAccount)
                .where(
                    PayoutAccount.user_id == account.user_id,
                    PayoutAccount.provider == account.provider,
                    PayoutAccount.status == "active",
                )
                .values(status="retired")
            )
            # Older pending proposals reference the superseded account. Close
            # them explicitly so a later submission can target the new version.
            await session.execute(
                update(PayoutAccount)
                .where(
                    PayoutAccount.user_id == account.user_id,
                    PayoutAccount.provider == account.provider,
                    PayoutAccount.status == "pending",
                    PayoutAccount.id != account.id,
                )
                .values(
                    status="rejected",
                    rejection_reason="其他账户已核验生效，请重新提交变更",
                    verified_by=admin,
                )
            )
            account.status, account.verified = "active", True
            account.verified_by, account.verification_reference = admin, reference
            await session.flush()
            return account
