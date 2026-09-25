import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ENUM, UUID, TIMESTAMP
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
    return ENUM(kind, name=name, values_callable=lambda values: [item.value for item in values], create_type=False)


def uuid_id() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))


def created_at() -> Mapped[datetime]:
    return mapped_column(TIMESTAMP(timezone=True, precision=6), nullable=False, server_default=text("CURRENT_TIMESTAMP"))


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role <> 'agent' OR referral_code IS NOT NULL", name="users_agent_referral_code_check"),
        Index("users_referral_code_key", "referral_code", unique=True),
        Index("users_parent_id_idx", "parent_id"),
        Index("users_wechat_open_id_key", "wechat_open_id", unique=True),
        Index("users_wechat_union_id_key", "wechat_union_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False, server_default=text("'agent'"))
    display_name: Mapped[str | None] = mapped_column(String(80))
    avatar_url: Mapped[str | None] = mapped_column(String(512))
    wechat_open_id: Mapped[str | None] = mapped_column(String(64))
    wechat_union_id: Mapped[str | None] = mapped_column(String(64))
    referral_code: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", name="users_parent_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"))
    parent_bound_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True, precision=6))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True, precision=6), nullable=False, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))


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
    promoter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", name="orders_promoter_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    profit_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_status: Mapped[PaymentStatus] = mapped_column(pg_enum(PaymentStatus, "payment_status"), nullable=False, server_default=text("'pending'"))
    settlement_status: Mapped[SettlementStatus] = mapped_column(pg_enum(SettlementStatus, "settlement_status"), nullable=False, server_default=text("'pending'"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True, precision=6), nullable=False, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="wallets_balance_nonnegative"),
        CheckConstraint("frozen_balance >= 0", name="wallets_frozen_balance_nonnegative"),
        CheckConstraint("total_earned >= 0", name="wallets_total_earned_nonnegative"),
        Index("wallets_user_id_key", "user_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", name="wallets_user_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, server_default=text("0"))
    frozen_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, server_default=text("0"))
    total_earned: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True, precision=6), nullable=False, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))


class CommissionLog(Base):
    __tablename__ = "commission_logs"
    __table_args__ = (
        CheckConstraint("rate >= 0 AND rate <= 1", name="commission_logs_rate_range"),
        CheckConstraint("commission_amount >= 0", name="commission_logs_amount_nonnegative"),
        Index("commission_logs_order_id_role_type_key", "order_id", "role_type", unique=True),
        Index("commission_logs_recipient_id_created_at_idx", "recipient_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id", name="commission_logs_order_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False)
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", name="commission_logs_recipient_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False)
    role_type: Mapped[CommissionRole] = mapped_column(pg_enum(CommissionRole, "commission_role"), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 6), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = created_at()


class PlatformCommissionLog(Base):
    __tablename__ = "platform_commission_logs"
    __table_args__ = (
        CheckConstraint("rate >= 0 AND rate <= 1", name="platform_commission_logs_rate_range"),
        CheckConstraint("commission_amount >= 0", name="platform_commission_logs_amount_nonnegative"),
        Index("platform_commission_logs_order_id_key", "order_id", unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_id()
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id", name="platform_commission_logs_order_id_fkey", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(7, 6), nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    created_at: Mapped[datetime] = created_at()
