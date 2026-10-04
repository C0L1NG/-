import time

import httpx
import pytest

from app.config import Settings
from app.db import engine_options
from app.errors import APIError
from app.factory import create_app
from app.payments import verify_merchant_signature
from app.security import hash_password, verify_password


@pytest.mark.parametrize(
    "mode", ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]
)
def test_database_parameters_are_translated_before_asyncpg(mode):
    url, options = engine_options(
        f"postgresql://u:p@localhost/db?schema=tenant_a&sslmode={mode}&connection_limit=5&pool_timeout=10"
    )
    assert not url.query
    assert options["connect_args"]["ssl"] == mode
    assert options["connect_args"]["server_settings"]["search_path"] == '"tenant_a"'
    assert (
        options["pool_size"] == 5 and options["max_overflow"] == 0 and options["pool_timeout"] == 10
    )


@pytest.mark.parametrize(
    "suffix", ["unexpected=1", "schema=bad%3Bschema", "connection_limit=0", "sslmode=invalid"]
)
def test_unsupported_or_unsafe_database_configuration_fails_clearly(suffix):
    with pytest.raises(ValueError):
        engine_options("postgresql://u:p@localhost/db?" + suffix)


def test_payment_signature_rejects_stale_or_missing_configuration():
    with pytest.raises(APIError) as exc:
        verify_merchant_signature("", b"body", "1", "signature")
    assert exc.value.code == "PAYMENT_CHANNEL_NOT_CONFIGURED"
    with pytest.raises(APIError) as exc:
        verify_merchant_signature("s" * 32, b"body", str(int(time.time()) - 600), "signature")
    assert exc.value.code == "INVALID_PAYMENT_SIGNATURE"


def test_admin_password_hash_never_contains_password_and_checks_correctly():
    value = hash_password("long-password-123")
    assert "long-password-123" not in value
    assert verify_password("long-password-123", value)
    assert not verify_password("wrong", value)


class FailingWechat:
    async def code2session(self, _):
        raise RuntimeError("do-not-leak-secret")


@pytest.mark.asyncio
async def test_uncaught_upstream_failure_preserves_json_and_request_id():
    settings = Settings(
        "postgresql://u:p@localhost/db",
        "x" * 32,
        "saas",
        "agent-portal",
        "admin-portal",
        "https://example.com",
    )
    app = create_app(settings, session_factory=lambda: None, wechat=FailingWechat())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/api/auth/wechat/login", json={"code": "wx-code"})
        assert response.status_code == 500 and response.headers["content-type"].startswith(
            "application/json"
        )
        assert response.json()["code"] == "INTERNAL_SERVER_ERROR"
        assert "do-not-leak-secret" not in response.text and response.headers["x-request-id"]
