import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.dialects import postgresql

from app.commission import calculate_order_commission, money, process_order_commission
from app.models import (
    CommissionLog,
    CommissionRole,
    Order,
    PaymentStatus,
    PlatformCommissionLog,
    SettlementStatus,
    User,
    UserRole,
    Wallet,
)


def test_direct_promoter_gets_entire_70_percent_pool():
    result = calculate_order_commission("100.00", False)
    assert tuple(
        map(money, (result.platform_amount, result.bonus_pool, result.promoter_amount))
    ) == ("30.00", "70.00", "70.00")
    assert result.parent_amount is None


def test_two_levels_get_49_and_21_percent_without_drift():
    result = calculate_order_commission("100.00", True)
    assert tuple(
        map(
            money,
            (
                result.platform_amount,
                result.bonus_pool,
                result.promoter_amount,
                result.parent_amount,
            ),
        )
    ) == ("30.00", "70.00", "49.00", "21.00")
    assert (
        result.platform_amount + result.promoter_amount + result.parent_amount
        == result.profit_amount
    )


@pytest.mark.parametrize("profit", ["0.01", "0.05", "0.07", "100000000.03"])
def test_remainder_is_allocated_once_to_the_direct_parent(profit):
    result = calculate_order_commission(profit, True)
    assert (
        result.platform_amount + result.promoter_amount + result.parent_amount
        == result.profit_amount
    )
    assert result.parent_amount >= 0
    assert all(
        value.as_tuple().exponent >= -2
        for value in (result.platform_amount, result.promoter_amount, result.parent_amount)
    )


@pytest.mark.parametrize("profit", ["-1.00", "0.001", "NaN", "Infinity"])
def test_invalid_profit_is_rejected(profit):
    with pytest.raises(ValueError):
        calculate_order_commission(profit, True)


def test_trailing_zero_precision_matches_decimal_js():
    assert calculate_order_commission("1.000", True).profit_amount == Decimal("1.00")


class ScalarRows:
    def __init__(self, value):
        self.value = value

    def one_or_none(self):
        return self.value


class FakeTransaction:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, error_type, _error, _traceback):
        self.session.committed = error_type is None


class FakeSession:
    def __init__(self, order, promoter):
        self.order, self.promoter = order, promoter
        self.selects = []
        self.writes = []
        self.created = []
        self.committed = False
        self.missing_wallet = False
        self.responses = [uuid.uuid4()] * (2 if promoter.parent_id else 1) + [order.id]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    def begin(self):
        return FakeTransaction(self)

    async def scalars(self, statement):
        self.selects.append(statement)
        model = statement.column_descriptions[0]["entity"]
        if model is Order:
            return ScalarRows(self.order)
        if self.missing_wallet and model is Wallet:
            return ScalarRows(None)
        return ScalarRows(
            model(
                balance=Decimal(0),
                frozen_balance=Decimal(0),
                total_earned=Decimal(0),
                debt_balance=Decimal(0),
            )
        )

    async def execute(self, statement):
        self.writes.append(statement)

    async def scalar(self, statement):
        self.writes.append(statement)
        return self.responses.pop(0)

    def add(self, value):
        self.created.append(value)

    def add_all(self, values):
        self.created.extend(values)


@pytest.mark.asyncio
@pytest.mark.parametrize("has_parent", [False, True])
async def test_settlement_uses_row_locks_and_atomic_wallet_updates(has_parent):
    order_id, promoter_id = uuid.uuid4(), uuid.uuid4()
    parent_id = uuid.uuid4() if has_parent else None
    order = Order(
        id=order_id,
        promoter_id=promoter_id,
        profit_amount=Decimal("100.00"),
        payment_status=PaymentStatus.PAID,
        settlement_status=SettlementStatus.PENDING,
        attribution_parent_id=parent_id,
        attribution_locked_at=datetime.now(timezone.utc),
        rule_version="two_level_v1",
    )
    promoter = User(id=promoter_id, role=UserRole.AGENT, parent_id=parent_id)
    fake = FakeSession(order, promoter)
    result = await process_order_commission(str(order_id), lambda: fake)
    assert result == {
        "status": "settled",
        "orderId": str(order_id),
        "platformAmount": "30.00",
        "bonusPool": "70.00",
        "promoterAmount": "49.00" if has_parent else "70.00",
        "parentAmount": "21.00" if has_parent else None,
    }
    assert fake.committed
    sql = [str(statement.compile(dialect=postgresql.dialect())) for statement in fake.selects]
    assert all("FOR UPDATE" in statement for statement in sql)
    assert len(fake.writes) == (3 if has_parent else 2)
    for statement in fake.writes:
        compiled = str(statement.compile(dialect=postgresql.dialect()))
        table = statement.table.name
        assert f"balance=({table}.balance +" in compiled
        assert f"total_earned=({table}.total_earned +" in compiled
    assert sum(isinstance(value, PlatformCommissionLog) for value in fake.created) == 1
    logs = [value for value in fake.created if isinstance(value, CommissionLog)]
    assert len(logs) == (2 if has_parent else 1)
    assert [log.role_type for log in logs] == (
        [CommissionRole.PROMOTER, CommissionRole.PARENT]
        if has_parent
        else [CommissionRole.PROMOTER]
    )


@pytest.mark.asyncio
async def test_duplicate_settlement_has_no_wallet_or_log_writes():
    order_id = uuid.uuid4()
    order = Order(id=order_id, settlement_status=SettlementStatus.SETTLED)
    fake = FakeSession(order, User(id=uuid.uuid4(), role=UserRole.AGENT))
    assert await process_order_commission(str(order_id), lambda: fake) == {
        "status": "already_settled",
        "orderId": str(order_id),
    }
    assert fake.committed and fake.writes == [] and fake.created == []


@pytest.mark.asyncio
async def test_unpaid_order_cannot_credit_wallets():
    order_id = uuid.uuid4()
    order = Order(
        id=order_id,
        payment_status=PaymentStatus.PENDING,
        settlement_status=SettlementStatus.PENDING,
    )
    fake = FakeSession(order, User(id=uuid.uuid4(), role=UserRole.AGENT))
    with pytest.raises(ValueError, match="has not been paid"):
        await process_order_commission(str(order_id), lambda: fake)
    assert not fake.committed and fake.writes == [] and fake.created == []


@pytest.mark.asyncio
async def test_missing_second_wallet_rolls_back_whole_settlement():
    order_id, promoter_id, parent_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    order = Order(
        id=order_id,
        promoter_id=promoter_id,
        profit_amount=Decimal("100.00"),
        payment_status=PaymentStatus.PAID,
        settlement_status=SettlementStatus.PENDING,
        attribution_parent_id=parent_id,
        attribution_locked_at=datetime.now(timezone.utc),
        rule_version="two_level_v1",
    )
    fake = FakeSession(order, User(id=promoter_id, role=UserRole.AGENT, parent_id=parent_id))
    fake.missing_wallet = True
    with pytest.raises(ValueError, match="Wallet for agent"):
        await process_order_commission(str(order_id), lambda: fake)
    assert not fake.committed and not any(
        isinstance(value, CommissionLog) for value in fake.created
    )
