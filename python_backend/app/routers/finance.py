import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from ..commission import money, process_order_commission
from ..db import get_session
from ..errors import APIError
from ..models import (
    Order,
    PaymentInbox,
    PayoutAccount,
    PlatformWallet,
    User,
    UserRole,
    Wallet,
    Withdrawal,
    WithdrawalAction,
)
from ..payments import (
    PaymentNotice,
    accept_payment_notice,
    process_payment_inbox,
    verify_merchant_signature,
)
from ..presentation import iso_utc
from ..schemas import (
    CommissionResult,
    OperationsSummary,
    OrderCreated,
    PaymentInboxPage,
    PayoutAccountData,
    PayoutAccountPage,
    PayoutDetails,
    PendingAccountPage,
    WalletState,
    WithdrawalData,
    WithdrawalPage,
)
from ..security import current_admin_id, current_agent_id
from ..withdrawals import request_withdrawal, review_withdrawal

router = APIRouter(tags=["financial lifecycle"])


class OrderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    orderNo: str = Field(min_length=1, max_length=64)
    customerId: str = Field(min_length=1, max_length=128)
    promoterId: uuid.UUID
    totalAmount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    profitAmount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)


@router.post("/api/admin/orders", status_code=201, response_model=OrderCreated)
async def create_order(
    body: OrderBody, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    if body.profitAmount > body.totalAmount:
        raise APIError(400, "PROFIT_EXCEEDS_TOTAL")
    async with request.app.state.session_factory() as session:
        async with session.begin():
            # Lock against concurrent bind; the database trigger creates the snapshot.
            user = await session.scalar(
                select(User)
                .where(
                    User.id == body.promoterId,
                    User.role == UserRole.AGENT,
                    User.is_active.is_(True),
                )
                .with_for_update(read=True)
            )
            if not user:
                raise APIError(404, "AGENT_NOT_FOUND")
            prior = await session.scalar(select(Order).where(Order.order_no == body.orderNo))
            if prior:
                if (
                    prior.customer_id,
                    prior.promoter_id,
                    prior.total_amount,
                    prior.profit_amount,
                ) != (body.customerId, body.promoterId, body.totalAmount, body.profitAmount):
                    raise APIError(409, "ORDER_NUMBER_CONFLICT")
                return {"orderId": str(prior.id), "status": prior.payment_status.value}
            order = Order(
                order_no=body.orderNo,
                customer_id=body.customerId,
                promoter_id=body.promoterId,
                total_amount=body.totalAmount,
                profit_amount=body.profitAmount,
            )
            session.add(order)
            await session.flush()
            return {"orderId": str(order.id), "status": order.payment_status.value}


@router.post(
    "/api/payments/webhook", response_model=CommissionResult, response_model_exclude_unset=True
)
async def payment_webhook(
    request: Request, x_payment_timestamp: str = Header(""), x_payment_signature: str = Header("")
):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 16_384:
            raise APIError(413, "PAYLOAD_TOO_LARGE")
        chunks.append(chunk)
    raw = b"".join(chunks)
    verify_merchant_signature(
        request.app.state.settings.payment_webhook_secret,
        raw,
        x_payment_timestamp,
        x_payment_signature,
    )
    try:
        notice = PaymentNotice.model_validate_json(raw)
    except ValidationError as exc:
        raise APIError(400, "INVALID_PAYMENT_NOTICE") from exc
    return await accept_payment_notice(notice, request.app.state.session_factory)


@router.post(
    "/api/admin/orders/{order_id}/settle",
    response_model=CommissionResult,
    response_model_exclude_unset=True,
)
async def retry_settlement(
    order_id: uuid.UUID, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    try:
        return await process_order_commission(str(order_id), request.app.state.session_factory)
    except ValueError as exc:
        raise APIError(409, "ORDER_CANNOT_SETTLE", str(exc)) from exc


class AccountBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["wechat", "bank"]
    # Bank identifiers are references from a secure payment vault, never raw card numbers.
    vaultReference: str | None = Field(None, pattern=r"^vault_[a-zA-Z0-9_-]{8,100}$")
    label: str = Field("收款账户", max_length=80)


def account_json(account: PayoutAccount) -> dict:
    return {
        "id": str(account.id),
        "provider": account.provider,
        "label": account.label,
        "verified": account.verified,
    }


async def save_account(body: AccountBody, owner: uuid.UUID, request: Request):
    async with request.app.state.session_factory() as session:
        async with session.begin():
            user = await session.get(User, owner)
            if body.provider == "wechat":
                if not user.wechat_open_id:
                    raise APIError(409, "WECHAT_IDENTITY_REQUIRED")
                reference, verified, label = user.wechat_open_id, True, "本人微信零钱"
            else:
                if not body.vaultReference:
                    raise APIError(
                        400,
                        "BANK_VAULT_REFERENCE_REQUIRED",
                        "Use a verified payment vault reference",
                    )
                reference, verified, label = body.vaultReference, False, body.label
            # Account references are immutable. A replacement requires a separately verified account.
            account = await session.scalar(
                insert(PayoutAccount)
                .values(
                    user_id=owner,
                    provider=body.provider,
                    account_reference=reference,
                    label=label,
                    verified=verified,
                )
                .on_conflict_do_nothing(
                    index_elements=[PayoutAccount.user_id, PayoutAccount.provider]
                )
                .returning(PayoutAccount)
            )
            if not account:
                account = await session.scalar(
                    select(PayoutAccount).where(
                        PayoutAccount.user_id == owner, PayoutAccount.provider == body.provider
                    )
                )
                if account.account_reference != reference:
                    raise APIError(409, "PAYOUT_ACCOUNT_CHANGE_REQUIRES_REVIEW")
            return account_json(account)


@router.post("/api/agent/payout-accounts", response_model=PayoutAccountData)
async def agent_account(
    body: AccountBody, request: Request, owner: uuid.UUID = Depends(current_agent_id)
):
    return await save_account(body, owner, request)


@router.post("/api/admin/payout-accounts", response_model=PayoutAccountData)
async def admin_account(
    body: AccountBody, request: Request, owner: uuid.UUID = Depends(current_admin_id)
):
    return await save_account(body, owner, request)


@router.get("/api/agent/payout-accounts", response_model=PayoutAccountPage)
async def agent_accounts(
    owner: uuid.UUID = Depends(current_agent_id), session=Depends(get_session)
):
    return {
        "items": [
            account_json(item)
            for item in (
                await session.scalars(
                    select(PayoutAccount)
                    .where(PayoutAccount.user_id == owner)
                    .order_by(PayoutAccount.created_at)
                )
            ).all()
        ]
    }


@router.get("/api/admin/payout-accounts", response_model=PayoutAccountPage)
async def admin_accounts(
    owner: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    return {
        "items": [
            account_json(item)
            for item in (
                await session.scalars(
                    select(PayoutAccount)
                    .where(PayoutAccount.user_id == owner)
                    .order_by(PayoutAccount.created_at)
                )
            ).all()
        ]
    }


class VerificationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verificationReference: str = Field(min_length=8, max_length=128)


@router.post("/api/admin/payout-accounts/{account_id}/verify", response_model=PayoutAccountData)
async def verify_account(
    account_id: uuid.UUID,
    body: VerificationBody,
    request: Request,
    admin: uuid.UUID = Depends(current_admin_id),
):
    async with request.app.state.session_factory() as session:
        async with session.begin():
            account = await session.scalar(
                select(PayoutAccount).where(PayoutAccount.id == account_id).with_for_update()
            )
            if not account:
                raise APIError(404, "PAYOUT_ACCOUNT_NOT_FOUND")
            if account.verified:
                if (
                    account.verification_reference
                    and account.verification_reference != body.verificationReference
                ):
                    raise APIError(409, "VERIFICATION_REFERENCE_CONFLICT")
                return account_json(account)
            account.verified, account.verified_by = True, admin
            account.verification_reference = body.verificationReference
            return account_json(account)


class WithdrawalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    accountId: uuid.UUID
    idempotencyKey: str = Field(min_length=8, max_length=80)


def withdrawal_json(item: Withdrawal, display_name: str | None = None):
    return {
        "id": str(item.id),
        "amount": money(item.amount),
        "status": item.status,
        "userId": str(item.user_id),
        "userName": display_name,
        "accountScope": item.account_scope,
        "createdAt": iso_utc(item.created_at),
        "payoutReference": item.payout_reference,
        "claimedBy": str(item.claimed_by) if item.claimed_by else None,
        "version": item.version,
        "rejectionReason": item.rejection_reason,
        "failureReference": item.failure_reference,
    }


@router.post("/api/agent/withdrawals", status_code=201, response_model=WithdrawalData)
async def agent_withdrawal(
    body: WithdrawalBody, request: Request, owner: uuid.UUID = Depends(current_agent_id)
):
    return withdrawal_json(
        await request_withdrawal(
            owner,
            "agent",
            body.amount,
            body.accountId,
            body.idempotencyKey,
            request.app.state.session_factory,
        )
    )


@router.post("/api/admin/withdrawals", status_code=201, response_model=WithdrawalData)
async def platform_withdrawal(
    body: WithdrawalBody, request: Request, owner: uuid.UUID = Depends(current_admin_id)
):
    return withdrawal_json(
        await request_withdrawal(
            owner,
            "platform",
            body.amount,
            body.accountId,
            body.idempotencyKey,
            request.app.state.session_factory,
        )
    )


@router.get("/api/agent/withdrawals", response_model=WithdrawalPage)
async def own_withdrawals(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    owner: uuid.UUID = Depends(current_agent_id),
    session=Depends(get_session),
):
    total = await session.scalar(
        select(func.count()).select_from(Withdrawal).where(Withdrawal.user_id == owner)
    )
    items = (
        await session.scalars(
            select(Withdrawal)
            .where(Withdrawal.user_id == owner)
            .order_by(Withdrawal.created_at.desc(), Withdrawal.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [withdrawal_json(item) for item in items],
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


@router.get("/api/admin/withdrawals", response_model=WithdrawalPage)
async def all_withdrawals(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    status: Literal["pending", "processing", "paid", "rejected"] | None = None,
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    filters = [Withdrawal.status == status] if status else []
    total = await session.scalar(select(func.count()).select_from(Withdrawal).where(*filters))
    items = (
        await session.execute(
            select(Withdrawal, User.display_name)
            .join(User, User.id == Withdrawal.user_id)
            .where(*filters)
            .order_by(Withdrawal.created_at.desc(), Withdrawal.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [withdrawal_json(item, name or "未命名账户") for item, name in items],
        "total": total,
        "page": page,
        "pageSize": pageSize,
    }


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["start", "confirm", "reject"]
    transferReference: str | None = Field(None, min_length=8, max_length=128)
    rejectionReason: str | None = Field(None, min_length=1, max_length=256)
    failureReference: str | None = Field(None, min_length=8, max_length=128)
    expectedVersion: int | None = Field(None, ge=0)


@router.post("/api/admin/withdrawals/{withdrawal_id}/review", response_model=WithdrawalData)
async def withdrawal_review(
    withdrawal_id: uuid.UUID,
    body: ReviewBody,
    request: Request,
    admin: uuid.UUID = Depends(current_admin_id),
):
    return withdrawal_json(
        await review_withdrawal(
            withdrawal_id,
            admin,
            body.action,
            body.transferReference,
            request.app.state.session_factory,
            reason=body.rejectionReason,
            failure_reference=body.failureReference,
            expected_version=body.expectedVersion,
        )
    )


@router.get("/api/admin/wallet", response_model=WalletState)
async def platform_account(
    _admin: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    account = await session.get(PlatformWallet, "platform")
    if not account:
        raise APIError(409, "WALLET_NOT_FOUND")
    return {
        "balance": money(account.balance),
        "frozenBalance": money(account.frozen_balance),
        "debtBalance": money(account.debt_balance),
        "totalEarned": money(account.total_earned),
    }


@router.get("/api/agent/wallet", response_model=WalletState)
async def agent_wallet(owner: uuid.UUID = Depends(current_agent_id), session=Depends(get_session)):
    account = await session.scalar(select(Wallet).where(Wallet.user_id == owner))
    if not account:
        raise APIError(409, "WALLET_NOT_FOUND")
    return {
        "balance": money(account.balance),
        "frozenBalance": money(account.frozen_balance),
        "debtBalance": money(account.debt_balance),
        "totalEarned": money(account.total_earned),
    }


@router.get("/health/live", include_in_schema=False)
async def live():
    return {"ok": True}


@router.get("/health/ready", include_in_schema=False)
async def ready(request: Request):
    try:
        async with request.app.state.session_factory() as session:
            if (
                await session.scalar(text("SELECT 1 FROM platform_wallets WHERE id='platform'"))
                != 1
            ):
                raise APIError(503, "PLATFORM_WALLET_NOT_READY")
            await session.execute(
                text("SELECT status,attempts,next_attempt_at FROM payment_inbox LIMIT 0")
            )
            await session.execute(
                text(
                    "SELECT claimed_by,version,rejection_reason,failure_reference FROM withdrawals LIMIT 0"
                )
            )
            await session.execute(
                text("SELECT window_start,attempts FROM auth_rate_limits LIMIT 0")
            )
    except Exception as exc:
        raise APIError(503, "DATABASE_NOT_READY") from exc
    return {"ok": True}


@router.get("/api/admin/withdrawals/{withdrawal_id}/payout-details", response_model=PayoutDetails)
async def payout_details(
    withdrawal_id: uuid.UUID,
    admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    item = await session.get(Withdrawal, withdrawal_id)
    if not item:
        raise APIError(404, "WITHDRAWAL_NOT_FOUND")
    account = await session.get(PayoutAccount, item.account_id)
    if not account or account.user_id != item.user_id:
        raise APIError(409, "ACCOUNT_RECONCILIATION_REQUIRED")
    owner = await session.get(User, item.user_id)
    claimant = await session.get(User, item.claimed_by) if item.claimed_by else None
    wallet = (
        await session.scalar(select(Wallet).where(Wallet.user_id == item.user_id))
        if item.account_scope == "agent"
        else await session.get(PlatformWallet, "platform")
    )
    if wallet is None:
        raise APIError(409, "WALLET_NOT_FOUND")
    history = (
        await session.execute(
            select(WithdrawalAction, User.display_name)
            .join(User, User.id == WithdrawalAction.actor_id)
            .where(WithdrawalAction.withdrawal_id == item.id)
            .order_by(WithdrawalAction.version)
        )
    ).all()
    return {
        "ownerName": owner.display_name or "未命名账户",
        "claimedBy": str(item.claimed_by) if item.claimed_by else None,
        "claimantName": (claimant.display_name or "管理员") if claimant else None,
        "canReview": item.status == "pending" or item.claimed_by == admin,
        "version": item.version,
        "debtBalance": money(wallet.debt_balance),
        "frozenBalance": money(wallet.frozen_balance),
        "payoutBlocked": wallet.debt_balance > 0 or wallet.frozen_balance < item.amount,
        "history": [
            {
                "actorId": str(entry.actor_id),
                "actorName": name or "管理员",
                "action": entry.action,
                "fromStatus": entry.from_status,
                "toStatus": entry.to_status,
                "version": entry.version,
                "reference": entry.reference,
                "reason": entry.reason,
                "createdAt": iso_utc(entry.created_at),
            }
            for entry, name in history
        ],
        "withdrawalId": str(item.id),
        "amount": money(item.amount),
        "provider": account.provider,
        "accountReference": account.account_reference,
        "accountLabel": account.label,
        "verified": account.verified,
        "status": item.status,
    }


@router.get("/api/admin/payout-accounts/pending", response_model=PendingAccountPage)
async def pending_accounts(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    condition = PayoutAccount.verified.is_(False)
    total = await session.scalar(select(func.count()).select_from(PayoutAccount).where(condition))
    items = (
        await session.scalars(
            select(PayoutAccount)
            .where(condition)
            .order_by(PayoutAccount.created_at, PayoutAccount.id)
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "items": [
            {
                **account_json(item),
                "userId": str(item.user_id),
                "accountReference": item.account_reference,
            }
            for item in items
        ],
        "page": page,
        "pageSize": pageSize,
        "total": total,
    }


@router.get("/api/admin/payment-events", response_model=PaymentInboxPage)
async def payment_events(
    page: int = Query(1, ge=1, le=10_000),
    pageSize: int = Query(20, ge=1, le=100),
    status: Literal["pending", "failed", "processed"] | None = None,
    _admin: uuid.UUID = Depends(current_admin_id),
    session=Depends(get_session),
):
    filters = [PaymentInbox.status == status] if status else []
    total = await session.scalar(select(func.count()).select_from(PaymentInbox).where(*filters))
    items = (
        await session.scalars(
            select(PaymentInbox)
            .where(*filters)
            .order_by(PaymentInbox.created_at.desc(), PaymentInbox.id.desc())
            .offset((page - 1) * pageSize)
            .limit(pageSize)
        )
    ).all()
    return {
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "items": [
            {
                "id": str(item.id),
                "provider": item.provider,
                "eventId": item.event_id,
                "orderId": item.payload["orderId"],
                "eventType": item.payload["type"],
                "status": item.status,
                "attempts": item.attempts,
                "lastError": item.last_error,
                "nextAttemptAt": iso_utc(item.next_attempt_at),
                "createdAt": iso_utc(item.created_at),
            }
            for item in items
        ],
    }


@router.get("/api/admin/operations-summary", response_model=OperationsSummary)
async def operations_summary(
    _admin: uuid.UUID = Depends(current_admin_id), session=Depends(get_session)
):
    withdrawal_counts = dict(
        (
            await session.execute(
                select(Withdrawal.status, func.count()).group_by(Withdrawal.status)
            )
        ).all()
    )
    payment_counts = dict(
        (
            await session.execute(
                select(PaymentInbox.status, func.count()).group_by(PaymentInbox.status)
            )
        ).all()
    )
    unverified = await session.scalar(
        select(func.count()).select_from(PayoutAccount).where(PayoutAccount.verified.is_(False))
    )
    return {
        "pendingWithdrawals": withdrawal_counts.get("pending", 0),
        "processingWithdrawals": withdrawal_counts.get("processing", 0),
        "failedPaymentEvents": payment_counts.get("failed", 0),
        "pendingPaymentEvents": payment_counts.get("pending", 0),
        "unverifiedAccounts": unverified or 0,
    }


@router.post(
    "/api/admin/payment-events/{event_id}/retry",
    response_model=CommissionResult,
    response_model_exclude_unset=True,
)
async def retry_payment_event(
    event_id: uuid.UUID, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    return await process_payment_inbox(event_id, request.app.state.session_factory)
