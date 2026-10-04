import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import ENUM, JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    ADMIN = "admin"
    AGENT = "agent"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class SettlementStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SETTLED = "settled"
    REVERSED = "reversed"


class CommissionRole(str, Enum):
    PROMOTER = "promoter"
    PARENT = "parent"


def pg_enum(kind: type[Enum], name: str) -> ENUM:
    return ENUM(
        kind,
        name=name,
        values_callable=lambda values: [item.value for item in values],
        create_type=False,
    )


def uuid_id() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


def created_at() -> Mapped[datetime]:
    return mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "role <> 'agent' OR referral_code IS NOT NULL", name="users_agent_referral_code_check"
        ),
        Index("users_referral_code_key", "referral_code", unique=True),
        Index("users_parent_id_idx", "parent_id"),
        Index("users_wechat_open_id_key", "wechat_open_id", unique=True),
        Index("users_wechat_union_id_key", "wechat_union_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"), nullable=False, server_default=text("'agent'")
    )
    display_name: Mapped[str | None] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(512))
    wechat_open_id: Mapped[str | None] = mapped_column(String(64))
    wechat_union_id: Mapped[str | None] = mapped_column(String(64))
    referral_code: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id", name="users_parent_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"
        ),
    )
    parent_bound_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    login_name: Mapped[str | None] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(256))
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("total_amount >= 0", name="orders_total_amount_nonnegative"),
        CheckConstraint("profit_amount >= 0", name="orders_profit_amount_nonnegative"),
        CheckConstraint("profit_amount <= total_amount", name="orders_profit_within_total"),
        Index("orders_order_no_key", "order_no", unique=True),
        Index("orders_customer_id_idx", "customer_id"),
        Index("orders_promoter_id_idx", "promoter_id"),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    order_no: Mapped[str] = mapped_column(String(64), nullable=False)
    customer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    promoter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id", name="orders_promoter_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"
        ),
        nullable=False,
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    profit_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_status: Mapped[PaymentStatus] = mapped_column(
        pg_enum(PaymentStatus, "payment_status"), nullable=False, server_default=text("'pending'")
    )
    settlement_status: Mapped[SettlementStatus] = mapped_column(
        pg_enum(SettlementStatus, "settlement_status"),
        nullable=False,
        server_default=text("'pending'"),
    )
    attribution_parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    attribution_locked_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True, precision=6)
    )
    rule_version: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'two_level_v1'")
    )
    paid_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    settled_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    refunded_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    payment_reference: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="wallets_balance_nonnegative"),
        CheckConstraint("frozen_balance >= 0", name="wallets_frozen_balance_nonnegative"),
        CheckConstraint("total_earned >= 0", name="wallets_total_earned_nonnegative"),
        Index("wallets_user_id_key", "user_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id", name="wallets_user_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"
        ),
        nullable=False,
    )
    balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    frozen_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    total_earned: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    debt_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        onupdate=text("CURRENT_TIMESTAMP"),
    )


class CommissionLog(Base):
    __tablename__ = "commission_logs"
    __table_args__ = (
        CheckConstraint("rate >= 0 AND rate <= 1", name="commission_logs_rate_range"),
        CheckConstraint("commission_amount >= 0", name="commission_logs_amount_nonnegative"),
        Index("commission_logs_order_id_role_type_key", "order_id", "role_type", unique=True),
        Index("commission_logs_recipient_id_created_at_idx", "recipient_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orders.id",
            name="commission_logs_order_id_fkey",
            ondelete="RESTRICT",
            onupdate="CASCADE",
        ),
        nullable=False,
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "users.id",
            name="commission_logs_recipient_id_fkey",
            ondelete="RESTRICT",
            onupdate="CASCADE",
        ),
        nullable=False,
    )
    role_type: Mapped[CommissionRole] = mapped_column(
        pg_enum(CommissionRole, "commission_role"), nullable=False
    )
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 6), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = created_at()


class PlatformCommissionLog(Base):
    __tablename__ = "platform_commission_logs"
    __table_args__ = (
        CheckConstraint("rate >= 0 AND rate <= 1", name="platform_commission_logs_rate_range"),
        CheckConstraint(
            "commission_amount >= 0", name="platform_commission_logs_amount_nonnegative"
        ),
        Index("platform_commission_logs_order_id_key", "order_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "orders.id",
            name="platform_commission_logs_order_id_fkey",
            ondelete="RESTRICT",
            onupdate="CASCADE",
        ),
        nullable=False,
    )
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 6), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = created_at()


class PlatformWallet(Base):
    __tablename__ = "platform_wallets"
    id: Mapped[str] = mapped_column(String(20), primary_key=True, server_default=text("'platform'"))
    balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    frozen_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    total_earned: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    debt_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class WalletMovement(Base):
    __tablename__ = "wallet_movements"
    __table_args__ = (
        Index(
            "wallet_movements_business_kind_account_key",
            "business_id",
            "kind",
            "account_key",
            unique=True,
        ),
    )
    id: Mapped[uuid.UUID] = uuid_id()
    account_key: Mapped[str] = mapped_column(String(40), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    business_id: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    balance_delta: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    frozen_delta: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    earned_delta: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    debt_delta: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = created_at()


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[uuid.UUID] = uuid_id()
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (
        Index("payment_events_provider_event_key", "provider", "event_id", unique=True),
    )


class Refund(Base):
    __tablename__ = "refunds"
    id: Mapped[uuid.UUID] = uuid_id()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    payment_reference: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    platform_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    agent_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = created_at()


class PayoutAccount(Base):
    __tablename__ = "payout_accounts"
    id: Mapped[uuid.UUID] = uuid_id()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    account_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    verification_reference: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (
        Index("payout_accounts_user_provider_key", "user_id", "provider", unique=True),
    )


class Withdrawal(Base):
    __tablename__ = "withdrawals"
    id: Mapped[uuid.UUID] = uuid_id()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payout_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    account_scope: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'pending'")
    )
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    payout_reference: Mapped[str | None] = mapped_column(String(128), unique=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    rejection_reason: Mapped[str | None] = mapped_column(String(256))
    failure_reference: Mapped[str | None] = mapped_column(String(128))
    claimed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    __table_args__ = (
        Index("withdrawals_user_idempotency_key", "user_id", "idempotency_key", unique=True),
    )


class WebLoginTicket(Base):
    __tablename__ = "web_login_tickets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    token_version: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True, precision=6), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))


class WithdrawalAction(Base):
    __tablename__ = "withdrawal_actions"
    id: Mapped[uuid.UUID] = uuid_id()
    withdrawal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("withdrawals.id", ondelete="RESTRICT"), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    from_status: Mapped[str] = mapped_column(String(20), nullable=False)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(128))
    reason: Mapped[str | None] = mapped_column(String(256))
    created_at: Mapped[datetime] = created_at()
    __table_args__ = (
        Index(
            "withdrawal_actions_withdrawal_id_version_key", "withdrawal_id", "version", unique=True
        ),
    )


class PaymentInbox(Base):
    __tablename__ = "payment_inbox"
    id: Mapped[uuid.UUID] = uuid_id()
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'pending'")
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(String(80))
    next_attempt_at: Mapped[datetime] = created_at()
    created_at: Mapped[datetime] = created_at()
    processed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    __table_args__ = (
        Index("payment_inbox_provider_event_id_key", "provider", "event_id", unique=True),
    )


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False)
