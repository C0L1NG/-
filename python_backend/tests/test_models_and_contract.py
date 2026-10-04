import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import jwt
import pytest
from sqlalchemy import Numeric
from sqlalchemy.dialects.postgresql import ENUM

from app.config import Settings
from app.factory import create_app
from app.models import (
    Base,
    CommissionLog,
    CommissionRole,
    Order,
    SettlementStatus,
    User,
    UserRole,
    Wallet,
)
from app.wechat import WechatSession

SETTINGS = Settings(
    "postgresql://u:p@localhost/db?schema=public",
    "x" * 32,
    "saas-distribution",
    "agent-portal",
    "admin-portal",
    "https://example.com/register",
)


def test_sqlalchemy_tables_match_the_existing_prisma_schema():
    expected = {
        "users": {
            "id",
            "role",
            "display_name",
            "avatar_url",
            "wechat_open_id",
            "wechat_union_id",
            "referral_code",
            "parent_id",
            "parent_bound_at",
            "created_at",
            "updated_at",
        },
        "orders": {
            "id",
            "order_no",
            "customer_id",
            "promoter_id",
            "total_amount",
            "profit_amount",
            "payment_status",
            "settlement_status",
            "created_at",
            "updated_at",
        },
        "wallets": {
            "id",
            "user_id",
            "balance",
            "frozen_balance",
            "total_earned",
            "created_at",
            "updated_at",
        },
        "commission_logs": {
            "id",
            "order_id",
            "recipient_id",
            "role_type",
            "rate",
            "commission_amount",
            "created_at",
        },
        "platform_commission_logs": {"id", "order_id", "rate", "commission_amount", "created_at"},
    }
    for name, columns in expected.items():
        assert columns <= set(Base.metadata.tables[name].columns.keys())
    assert Base.metadata.tables["users"].c.role.type.name == "user_role"
    assert isinstance(Base.metadata.tables["users"].c.role.type, ENUM)
    assert {index.name for index in Base.metadata.tables["users"].indexes} >= {
        "users_referral_code_key",
        "users_parent_id_idx",
    }
    assert {
        key.name for table in Base.metadata.tables.values() for key in table.foreign_key_constraints
    } >= {
        "users_parent_id_fkey",
        "orders_promoter_id_fkey",
        "wallets_user_id_fkey",
        "commission_logs_order_id_fkey",
        "commission_logs_recipient_id_fkey",
        "platform_commission_logs_order_id_fkey",
    }
    for table, column in [
        ("orders", "total_amount"),
        ("orders", "profit_amount"),
        ("wallets", "balance"),
        ("wallets", "frozen_balance"),
        ("wallets", "total_earned"),
        ("commission_logs", "commission_amount"),
        ("platform_commission_logs", "commission_amount"),
    ]:
        value_type = Base.metadata.tables[table].c[column].type
        assert isinstance(value_type, Numeric) and (value_type.precision, value_type.scale) == (
            18,
            2,
        )
    assert (
        Base.metadata.tables["commission_logs"].c.rate.type.precision,
        Base.metadata.tables["commission_logs"].c.rate.type.scale,
    ) == (7, 6)


@pytest.fixture(autouse=True)
def fake_rate_limit(monkeypatch):
    # Mocked JSON/auth contracts; shared counters have separate PG integration tests.
    async def noop(_request):
        pass

    monkeypatch.setattr("app.factory.check_login_limit", noop)


class FakeSession:
    def in_transaction(self):
        return False

    def __init__(self, role=UserRole.AGENT):
        self.role = role

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def execute(self, _statement):
        return None

    async def get(self, model, key):
        assert model is User
        return User(id=key, role=self.role)

    async def scalar(self, _statement):
        return "AG7F01A2"


def token(subject: uuid.UUID, audience: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(subject),
            "iss": SETTINGS.jwt_issuer,
            "aud": audience,
            "exp": now + timedelta(hours=1),
        },
        SETTINGS.jwt_secret,
        algorithm="HS256",
    )


@pytest.mark.asyncio
async def test_original_routes_methods_and_swagger_schema_exist():
    app = create_app(SETTINGS, session_factory=lambda: FakeSession())
    expected = {
        ("post", "/api/auth/wechat/login"),
        ("get", "/api/agent/overview"),
        ("get", "/api/agent/referral"),
        ("get", "/api/agent/team"),
        ("post", "/api/agent/logout"),
        ("post", "/api/agent/bind-parent"),
        ("get", "/api/agent/mini-program-code"),
        ("get", "/api/agent/ledger"),
        ("get", "/api/admin/overview"),
        ("get", "/api/admin/team-tree"),
        ("get", "/api/admin/agents/{agentId}"),
        ("get", "/api/admin/commission-audit"),
    }
    actual = {
        (method, path)
        for path, data in app.openapi()["paths"].items()
        for method in data
        if method in {"get", "post"}
    }
    assert actual >= expected
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/docs")).status_code == 200
        logout = await client.post("/api/agent/logout")
        assert logout.json() == {"ok": True}
        assert "agent_access_token=" in logout.headers["set-cookie"]


@pytest.mark.asyncio
async def test_referral_json_and_cookie_bearer_auth_are_compatible():
    agent_id = uuid.uuid4()
    app = create_app(SETTINGS, session_factory=lambda: FakeSession())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/agent/referral")).status_code == 401
        assert (await client.get("/api/agent/referral?recipientId=x")).status_code == 401
        assert (await client.get("/api/agent/ledger?pageSize=0")).status_code == 401
        headers = {"Authorization": "Bearer " + token(agent_id, "agent-portal")}
        response = await client.get("/api/agent/referral", headers=headers)
        assert response.status_code == 200
        assert response.json() == {
            "referralCode": "AG7F01A2",
            "referralUrl": "https://example.com/register?ref=AG7F01A2",
        }
        client.cookies.set("agent_access_token", token(agent_id, "agent-portal"))
        cookie_response = await client.get("/api/agent/referral")
        assert cookie_response.json() == response.json()
        invalid = await client.get("/api/agent/referral?recipientId=x", headers=headers)
        assert invalid.status_code == 400
        assert invalid.json() == {
            "statusCode": 400,
            "code": "FST_ERR_VALIDATION",
            "error": "Bad Request",
            "message": "Unknown query parameter",
        }
        assert (await client.get("/api/admin/overview", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_current_database_role_restricts_agent_access():
    app = create_app(SETTINGS, session_factory=lambda: FakeSession(UserRole.ADMIN))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/agent/referral",
            headers={"Authorization": "Bearer " + token(uuid.uuid4(), "agent-portal")},
        )
        assert response.status_code == 403
        assert response.json()["code"] == "FORBIDDEN"


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def one(self):
        return self.rows[0]

    def all(self):
        return self.rows


class AdminSession(FakeSession):
    def __init__(self):
        super().__init__(UserRole.ADMIN)

    async def scalar(self, statement):
        sql = str(statement)
        if "FROM refunds" in sql:
            return Decimal(0)
        if "platform_commission_logs" in sql:
            return Decimal("30.00")
        if "commission_logs" in sql:
            return Decimal("70.00")
        if "DISTINCT" in sql.upper():
            return 2
        return 3

    async def execute(self, statement):
        if str(statement).startswith("SET TRANSACTION"):
            return None
        sql = str(statement)
        if "sum(orders.total_amount)" in sql:
            return FakeResult([(Decimal("250.00"), 2)])
        return FakeResult([])


@pytest.mark.asyncio
async def test_admin_overview_json_omits_daily_field_for_all_time():
    app = create_app(SETTINGS, session_factory=lambda: AdminSession())
    headers = {"Authorization": "Bearer " + token(uuid.uuid4(), "admin-portal")}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/admin/overview", headers=headers)
        assert response.status_code == 200
        assert response.json() == {
            "platformTotalRevenue": "30.00",
            "totalGmv": "250.00",
            "agentCommissionPool": "70.00",
            "agentCount": 3,
            "paidOrderCount": 2,
        }
        daily = await client.get("/api/admin/overview?period=day", headers=headers)
        assert daily.status_code == 200
        assert daily.json()["activePromoterCount"] == 2
        assert (await client.get("/api/agent/overview", headers=headers)).status_code == 401


class AgentSession(FakeSession):
    def __init__(self):
        super().__init__(UserRole.AGENT)
        self.user_id = None

    async def get(self, model, key):
        self.user_id = key
        return User(
            id=key, role=UserRole.AGENT, display_name="青禾", avatar_url=None, parent_id=None
        )

    async def scalar(self, statement):
        sql = str(statement)
        if "FROM wallets" in sql:
            return Wallet(
                user_id=self.user_id, balance=Decimal("90.10"), total_earned=Decimal("190.20")
            )
        if "FROM users" in sql and "count" in sql:
            return 2
        if "FROM commission_logs" in sql:
            return 1
        return None

    async def execute(self, statement):
        if str(statement).startswith("SET TRANSACTION"):
            return None
        sql = str(statement)
        if "JOIN orders" in sql and "FROM commission_logs" in sql:
            moment = datetime(2026, 9, 25, 12, 30, tzinfo=timezone.utc)
            log = CommissionLog(
                id=uuid.uuid4(),
                role_type=CommissionRole.PARENT,
                rate=Decimal("0.210000"),
                commission_amount=Decimal("21.00"),
                created_at=moment,
            )
            order = Order(
                order_no="ORD-001",
                profit_amount=Decimal("100.00"),
                settlement_status=SettlementStatus.SETTLED,
            )
            return FakeResult([(log, order)])
        return FakeResult([])


@pytest.mark.asyncio
async def test_agent_overview_and_ledger_keep_exact_json_shapes():
    app = create_app(SETTINGS, session_factory=lambda: AgentSession())
    headers = {"Authorization": "Bearer " + token(uuid.uuid4(), "agent-portal")}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        overview = await client.get("/api/agent/overview", headers=headers)
        assert overview.status_code == 200
        assert set(overview.json()) == {
            "displayName",
            "avatarUrl",
            "balance",
            "totalEarned",
            "directAgentCount",
            "currentCommissionRatePercent",
            "todayEstimatedEarnings",
            "estimateDate",
            "estimateTimeZone",
        }
        assert overview.json()["balance"] == "90.10"
        assert overview.json()["todayEstimatedEarnings"] == "0.00"
        ledger = await client.get("/api/agent/ledger?page=1&pageSize=20", headers=headers)
        assert ledger.status_code == 200
        assert set(ledger.json()) == {"page", "pageSize", "total", "totalPages", "items"}
        assert ledger.json()["items"][0] == {
            "id": ledger.json()["items"][0]["id"],
            "orderNo": "ORD-001",
            "orderProfitAmount": "100.00",
            "roleType": "PARENT",
            "earningType": "DOWNLINE_REWARD",
            "rate": "0.21",
            "ratePercent": 21,
            "commissionAmount": "21.00",
            "settlementStatus": "SETTLED",
            "settledAt": "2026-09-25T12:30:00.000Z",
        }


class RichAdminSession(AdminSession):
    root_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
    child_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
    order_id = uuid.UUID("33333333-3333-4333-8333-333333333333")

    async def get(self, model, key):
        return User(id=key, role=UserRole.ADMIN, display_name="老板")

    async def scalar(self, statement):
        sql = str(statement)
        if "count(" in sql and "FROM orders JOIN users" in sql:
            return 1
        return await super().scalar(statement)

    async def scalars(self, statement):
        if "FROM platform_commission_logs" in str(statement):
            from app.models import PlatformCommissionLog

            return FakeResult(
                [
                    PlatformCommissionLog(
                        order_id=self.order_id,
                        rate=Decimal("0.300000"),
                        commission_amount=Decimal("30.00"),
                    )
                ]
            )
        return FakeResult([])

    async def execute(self, statement):
        if str(statement).startswith("SET TRANSACTION"):
            return None
        sql = str(statement)
        if "FROM users LEFT OUTER JOIN wallets" in sql:
            root = User(
                id=self.root_id,
                role=UserRole.AGENT,
                display_name="导师",
                referral_code="ROOT",
                parent_id=None,
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
            child = User(
                id=self.child_id,
                role=UserRole.AGENT,
                display_name="出单",
                referral_code="CHILD",
                parent_id=self.root_id,
                created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            )
            return FakeResult(
                [
                    (root, Decimal("50.00"), Decimal("80.00")),
                    (child, Decimal("20.00"), Decimal("49.00")),
                ]
            )
        if (
            "sum(orders.total_amount)" in sql or "orders.total_amount AS amount" in sql
        ) and "GROUP BY" in sql:
            return FakeResult([(self.child_id, Decimal("250.00"), 1)])
        if (
            "sum(platform_commission_logs.commission_amount)" in sql
            or "platform_commission_logs.commission_amount AS amount" in sql
        ):
            return FakeResult([(self.child_id, Decimal("30.00"))])
        if (
            "sum(commission_logs.commission_amount)" in sql
            or "commission_logs.commission_amount AS amount" in sql
        ):
            return FakeResult([(self.child_id, Decimal("21.00"))])
        if "FROM orders JOIN users" in sql and "count(" not in sql:
            order = Order(
                id=self.order_id,
                order_no="ORD-001",
                promoter_id=self.child_id,
                total_amount=Decimal("250.00"),
                profit_amount=Decimal("100.00"),
                settlement_status=SettlementStatus.SETTLED,
                created_at=datetime(2026, 9, 25, 12, 30, tzinfo=timezone.utc),
            )
            return FakeResult([(order, self.child_id, "出单")])
        if "FROM commission_logs JOIN users" in sql:
            promoter = CommissionLog(
                order_id=self.order_id,
                recipient_id=self.child_id,
                role_type=CommissionRole.PROMOTER,
                rate=Decimal("0.490000"),
                commission_amount=Decimal("49.00"),
            )
            mentor = CommissionLog(
                order_id=self.order_id,
                recipient_id=self.root_id,
                role_type=CommissionRole.PARENT,
                rate=Decimal("0.210000"),
                commission_amount=Decimal("21.00"),
            )
            return FakeResult([(promoter, "出单"), (mentor, "导师")])
        return await super().execute(statement)


@pytest.mark.asyncio
async def test_admin_tree_and_audit_keep_two_level_contract():
    app = create_app(SETTINGS, session_factory=lambda: RichAdminSession())
    headers = {"Authorization": "Bearer " + token(uuid.uuid4(), "admin-portal")}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        tree = await client.get("/api/admin/team-tree?period=month", headers=headers)
        assert tree.status_code == 200
        root = tree.json()["root"]
        assert set(root) == {"id", "type", "displayName", "children"}
        assert root["children"][0]["children"][0]["mentorPaidUp"] == "21.00"
        assert root["children"][0]["children"][0]["platformContribution"] == "30.00"
        audit = await client.get("/api/admin/commission-audit?page=1&pageSize=20", headers=headers)
        assert audit.status_code == 200
        item = audit.json()["items"][0]
        assert item["platform"] == {"ratePercent": 30, "amount": "30.00"}
        assert item["promoterCommission"]["amount"] == "49.00"
        assert item["mentorCommission"]["amount"] == "21.00"


class FakeWechat:
    async def code2session(self, code):
        assert code == "wx-one-time-code"
        return WechatSession("open-id-123")

    async def get_unlimited_code(self, scene, page):
        assert scene == "r=AG7F01A2" and page == "pages/home/index"
        return b"image-bytes", "image/png"


class LoginTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None


class LoginSession(FakeSession):
    user_id = uuid.UUID("44444444-4444-4444-8444-444444444444")
    calls = 0

    def begin(self):
        return LoginTransaction()

    async def scalar(self, statement):
        sql = str(statement)
        if sql.startswith("INSERT INTO users"):
            return self.user_id
        if "FROM users" in sql and "wechat_open_id" in sql:
            return User(id=self.user_id, role=UserRole.AGENT, parent_id=None)
        if "referral_code" in sql:
            return "AG7F01A2"
        return None

    async def execute(self, _statement):
        self.calls += 1

    async def get(self, _model, _key):
        return User(id=self.user_id, role=UserRole.AGENT)


@pytest.mark.asyncio
async def test_wechat_login_and_mini_program_code_match_original_fields():
    app = create_app(SETTINGS, session_factory=lambda: LoginSession(), wechat=FakeWechat())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        login = await client.post("/api/auth/wechat/login", json={"code": "wx-one-time-code"})
        assert login.status_code == 200
        payload = login.json()
        assert set(payload) == {"accessToken", "expiresIn", "agent"}
        assert payload["expiresIn"] == 7200
        assert payload["agent"] == {"id": str(LoginSession.user_id), "parentId": None}
        decoded = jwt.decode(
            payload["accessToken"],
            SETTINGS.jwt_secret,
            algorithms=["HS256"],
            audience="agent-portal",
            issuer=SETTINGS.jwt_issuer,
        )
        assert decoded["sub"] == str(LoginSession.user_id)
        code = await client.get(
            "/api/agent/mini-program-code",
            headers={"Authorization": "Bearer " + payload["accessToken"]},
        )
        assert code.status_code == 200
        assert code.json() == {
            "scene": "r=AG7F01A2",
            "page": "pages/home/index",
            "imageDataUrl": "data:image/png;base64,aW1hZ2UtYnl0ZXM=",
        }
