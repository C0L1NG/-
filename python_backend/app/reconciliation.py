from decimal import Decimal

from sqlalchemy import String, case, cast, exists, func, select, text
from sqlalchemy.orm import aliased

from .commission import calculate_order_commission
from .models import (
    CommissionLog,
    CommissionRole,
    Order,
    PaymentStatus,
    PlatformCommissionLog,
    PlatformWallet,
    Refund,
    Wallet,
    WalletMovement,
    Withdrawal,
    WithdrawalAction,
)


async def reconcile(session_factory):
    """Account and business checks must share the same read-only database snapshot."""
    discrepancies = []
    async with session_factory() as session:
        async with session.begin():
            await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            for check in (
                _check_account_totals,
                _check_movement_integrity,
                _check_withdrawal_states,
                _check_order_allocations,
            ):
                discrepancies.extend(await check(session))
    return discrepancies


async def _check_account_totals(session):
    discrepancies = []
    totals = (
        await session.execute(
            select(
                WalletMovement.account_key,
                func.sum(WalletMovement.balance_delta),
                func.sum(WalletMovement.frozen_delta),
                func.sum(WalletMovement.earned_delta),
                func.sum(WalletMovement.debt_delta),
            ).group_by(WalletMovement.account_key)
        )
    ).all()
    by_account = {key: tuple(values) for key, *values in totals}
    wallets = (await session.scalars(select(Wallet))).all()
    platform = await session.get(PlatformWallet, "platform")
    for account in [*wallets, platform]:
        if account is None:
            discrepancies.append("Platform wallet missing")
            continue
        key = str(account.user_id) if isinstance(account, Wallet) else "platform"
        actual = (
            account.balance,
            account.frozen_balance,
            account.total_earned,
            account.debt_balance,
        )
        if actual != by_account.get(key, (Decimal(0),) * 4):
            discrepancies.append(f"Account {key}: wallet balances differ from immutable movements")
    actual_keys = {str(wallet.user_id) for wallet in wallets} | (
        {"platform"} if platform else set()
    )
    discrepancies.extend(
        f"Account {key}: movements exist without a wallet"
        for key in by_account.keys() - actual_keys
    )
    return discrepancies


async def _check_movement_integrity(session):
    discrepancies = []
    shaped = (
        await session.scalars(
            select(WalletMovement.id).where(
                (
                    (WalletMovement.kind == "withdrawal_hold")
                    & (
                        (WalletMovement.balance_delta != -WalletMovement.amount)
                        | (WalletMovement.frozen_delta != WalletMovement.amount)
                        | (WalletMovement.earned_delta != 0)
                        | (WalletMovement.debt_delta != 0)
                    )
                )
                | (
                    (WalletMovement.kind == "withdrawal_paid")
                    & (
                        (WalletMovement.balance_delta != 0)
                        | (WalletMovement.frozen_delta != -WalletMovement.amount)
                        | (WalletMovement.earned_delta != 0)
                        | (WalletMovement.debt_delta != 0)
                    )
                )
                | (
                    (WalletMovement.kind == "withdrawal_release")
                    & (
                        (
                            WalletMovement.balance_delta - WalletMovement.debt_delta
                            != WalletMovement.amount
                        )
                        | (WalletMovement.frozen_delta != -WalletMovement.amount)
                        | (WalletMovement.earned_delta != 0)
                        | (WalletMovement.debt_delta > 0)
                    )
                )
                | (
                    (WalletMovement.kind == "commission")
                    & (
                        (
                            WalletMovement.balance_delta - WalletMovement.debt_delta
                            != WalletMovement.amount
                        )
                        | (WalletMovement.earned_delta != WalletMovement.amount)
                        | (WalletMovement.frozen_delta != 0)
                        | (WalletMovement.debt_delta > 0)
                    )
                )
                | (
                    (WalletMovement.kind == "refund")
                    & (
                        (
                            WalletMovement.balance_delta - WalletMovement.debt_delta
                            != -WalletMovement.amount
                        )
                        | (WalletMovement.earned_delta != -WalletMovement.amount)
                        | (WalletMovement.frozen_delta != 0)
                        | (WalletMovement.debt_delta < 0)
                    )
                )
            )
        )
    ).all()
    discrepancies.extend(f"Movement {key}: deltas differ from business operation" for key in shaped)
    orphaned = (
        await session.scalars(
            select(WalletMovement.id).where(
                (
                    (WalletMovement.kind.in_(["commission", "refund"]))
                    & ~exists(
                        select(Order.id).where(cast(Order.id, String) == WalletMovement.business_id)
                    )
                )
                | (
                    (WalletMovement.kind.like("withdrawal_%"))
                    & ~exists(
                        select(Withdrawal.id).where(
                            cast(Withdrawal.id, String) == WalletMovement.business_id
                        )
                    )
                )
                | (
                    (WalletMovement.user_id.is_not(None))
                    & (WalletMovement.account_key != cast(WalletMovement.user_id, String))
                )
                | ((WalletMovement.user_id.is_(None)) & (WalletMovement.account_key != "platform"))
            )
        )
    ).all()
    discrepancies.extend(
        f"Movement {key}: orphaned business or wrong account identity" for key in orphaned
    )
    return discrepancies


async def _check_withdrawal_states(session):
    discrepancies = []
    # Business states must agree with immutable money movements, not only totals.
    movement = (
        select(
            WalletMovement.business_id,
            WalletMovement.account_key,
            func.sum(case_kind("withdrawal_hold")).label("held"),
            func.sum(case_kind("withdrawal_paid")).label("paid"),
            func.sum(case_kind("withdrawal_release")).label("released"),
        )
        .where(WalletMovement.kind.like("withdrawal_%"))
        .group_by(WalletMovement.business_id, WalletMovement.account_key)
        .subquery()
    )
    rows = (
        await session.execute(
            select(
                Withdrawal,
                movement.c.held,
                movement.c.paid,
                movement.c.released,
            ).outerjoin(
                movement,
                (movement.c.business_id == cast(Withdrawal.id, String))
                & (
                    movement.c.account_key
                    == case(
                        (Withdrawal.account_scope == "platform", "platform"),
                        else_=cast(Withdrawal.user_id, String),
                    )
                ),
            )
        )
    ).all()
    for withdrawal, held, paid, released in rows:
        expected = (
            withdrawal.amount,
            withdrawal.amount if withdrawal.status == "paid" else Decimal(0),
            withdrawal.amount if withdrawal.status == "rejected" else Decimal(0),
        )
        if tuple(value or Decimal(0) for value in (held, paid, released)) != expected:
            discrepancies.append(
                f"Withdrawal {withdrawal.id}: status differs from hold/paid/release movements"
            )
    for withdrawal, _, _, _ in rows:
        if withdrawal.status == "processing" and not withdrawal.claimed_by:
            discrepancies.append(f"Withdrawal {withdrawal.id}: processing has no claimant")
        if withdrawal.status == "paid" and not withdrawal.payout_reference:
            discrepancies.append(
                f"Withdrawal {withdrawal.id}: paid has no successful channel receipt"
            )
    broken_actions = (
        await session.scalars(
            select(Withdrawal.id)
            .outerjoin(
                WithdrawalAction,
                (WithdrawalAction.withdrawal_id == Withdrawal.id)
                & (WithdrawalAction.version == Withdrawal.version),
            )
            .where(
                Withdrawal.version > 0,
                (WithdrawalAction.id.is_(None)) | (WithdrawalAction.to_status != Withdrawal.status),
            )
        )
    ).all()
    discrepancies.extend(
        f"Withdrawal {key}: latest immutable action differs from current state"
        for key in broken_actions
    )
    wrong_withdrawal_accounts = (
        await session.scalars(
            select(WalletMovement.id)
            .join(Withdrawal, cast(Withdrawal.id, String) == WalletMovement.business_id)
            .where(
                WalletMovement.kind.like("withdrawal_%"),
                WalletMovement.account_key
                != case(
                    (Withdrawal.account_scope == "platform", "platform"),
                    else_=cast(Withdrawal.user_id, String),
                ),
            )
        )
    ).all()
    discrepancies.extend(
        f"Movement {key}: withdrawal uses the wrong account" for key in wrong_withdrawal_accounts
    )
    return discrepancies


async def _check_order_allocations(session):
    discrepancies = []
    legacy_refunds = (
        await session.scalars(
            select(Order.id)
            .outerjoin(Refund, Refund.order_id == Order.id)
            .where(Order.payment_status == PaymentStatus.REFUNDED, Refund.id.is_(None))
        )
    ).all()
    discrepancies.extend(
        f"Order {key}: legacy refund needs opening-balance/channel reconciliation"
        for key in legacy_refunds
    )
    agent_totals = (
        select(
            CommissionLog.order_id,
            func.sum(CommissionLog.commission_amount).label("amount"),
        )
        .group_by(CommissionLog.order_id)
        .subquery()
    )
    broken = (
        await session.scalars(
            select(Order.id)
            .outerjoin(agent_totals, agent_totals.c.order_id == Order.id)
            .outerjoin(PlatformCommissionLog, PlatformCommissionLog.order_id == Order.id)
            .where(
                Order.settled_at.is_not(None),
                (agent_totals.c.amount.is_(None))
                | (PlatformCommissionLog.commission_amount.is_(None))
                | (
                    Order.profit_amount
                    != agent_totals.c.amount + PlatformCommissionLog.commission_amount
                ),
            )
        )
    ).all()
    discrepancies.extend(
        f"Order {key}: commission allocations do not conserve profit" for key in broken
    )
    own, parent = aliased(CommissionLog), aliased(CommissionLog)
    rows = (
        await session.execute(
            select(Order, PlatformCommissionLog, own, parent, Refund)
            .outerjoin(PlatformCommissionLog, PlatformCommissionLog.order_id == Order.id)
            .outerjoin(own, (own.order_id == Order.id) & (own.role_type == CommissionRole.PROMOTER))
            .outerjoin(
                parent,
                (parent.order_id == Order.id) & (parent.role_type == CommissionRole.PARENT),
            )
            .outerjoin(Refund, Refund.order_id == Order.id)
            .where(Order.settled_at.is_not(None) | Refund.id.is_not(None))
        )
    ).all()
    refund_entries = (
        await session.scalars(select(WalletMovement).where(WalletMovement.kind == "refund"))
    ).all()
    refunds_by_order = {}
    for entry in refund_entries:
        refunds_by_order.setdefault(entry.business_id, {})[entry.account_key] = entry.amount
    for order, platform_log, promoter_log, parent_log, refund in rows:
        if order.settled_at is not None:
            split = calculate_order_commission(
                order.profit_amount, order.attribution_parent_id is not None
            )
            correct = platform_log is not None and promoter_log is not None
            correct = (
                correct
                and platform_log.rate == Decimal("0.30")
                and platform_log.commission_amount == split.platform_amount
            )
            correct = (
                correct
                and promoter_log.recipient_id == order.promoter_id
                and promoter_log.commission_amount == split.promoter_amount
                and promoter_log.rate
                == (Decimal("0.49") if order.attribution_parent_id else Decimal("0.70"))
            )
            if order.attribution_parent_id:
                correct = (
                    correct
                    and parent_log is not None
                    and parent_log.recipient_id == order.attribution_parent_id
                    and parent_log.commission_amount == split.parent_amount
                    and parent_log.rate == Decimal("0.21")
                )
            else:
                correct = correct and parent_log is None
            if not correct:
                discrepancies.append(
                    f"Order {order.id}: beneficiaries/rates differ from locked attribution"
                )
        if refund:
            expected_platform = platform_log.commission_amount if platform_log else Decimal(0)
            expected_agents = sum(
                (log.commission_amount for log in (promoter_log, parent_log) if log),
                Decimal(0),
            )
            if (refund.total_amount, refund.platform_amount, refund.agent_amount) != (
                order.total_amount,
                expected_platform,
                expected_agents,
            ) or order.payment_status != PaymentStatus.REFUNDED:
                discrepancies.append(
                    f"Order {order.id}: refund record differs from original allocations"
                )
            actual_refunds = refunds_by_order.get(str(order.id), {})
            expected_refunds = {
                str(log.recipient_id): log.commission_amount
                for log in (promoter_log, parent_log)
                if log
            }
            if platform_log:
                expected_refunds["platform"] = platform_log.commission_amount
            if actual_refunds != expected_refunds:
                discrepancies.append(
                    f"Order {order.id}: refund movements differ from original beneficiaries"
                )
    return discrepancies


def case_kind(kind):
    return case((WalletMovement.kind == kind, WalletMovement.amount), else_=0)
