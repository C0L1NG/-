"""Real Next -> FastAPI -> disposable PG regression, using an already built Web app.

TEST_DATABASE_URL must end in _test. Node must be available on PATH.
"""

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from dataclasses import replace
from pathlib import Path

import httpx
import uvicorn
from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "python_backend"), str(ROOT / "python_backend/tests")]
from postgres_support import disposable_postgres  # noqa: E402
from test_financial_lifecycle import SETTINGS, token  # noqa: E402

from app.factory import create_app  # noqa: E402
from app.models import User, UserRole, Wallet  # noqa: E402
from app.security import hash_password  # noqa: E402


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def check_worker(factory):
    async with factory() as session:
        schema = await session.scalar(text("SELECT current_schema()"))
    database_url = (
        factory.kw["bind"].url.set(query={"schema": schema}).render_as_string(hide_password=False)
    )
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "app.worker"],
            cwd=ROOT / "python_backend",
            stdout=log,
            stderr=log,
            env={
                **os.environ,
                "DATABASE_URL": database_url,
                "JWT_SECRET": SETTINGS.jwt_secret,
                "JWT_ISSUER": SETTINGS.jwt_issuer,
                "JWT_AUDIENCE": SETTINGS.jwt_audience,
                "ADMIN_JWT_AUDIENCE": SETTINGS.admin_jwt_audience,
                "AGENT_REFERRAL_BASE_URL": SETTINGS.referral_base_url,
            },
        )
        try:
            for _ in range(100):
                await asyncio.sleep(0.1)
                log.seek(0)
                if "financial_reconciliation ok" in log.read():
                    return True
                if process.poll() is not None:
                    raise RuntimeError("Recovery worker exited before first cycle")
            raise RuntimeError("Recovery worker first cycle timed out")
        finally:
            process.terminate()
            try:
                await asyncio.to_thread(process.wait, 10)
            except subprocess.TimeoutExpired:
                process.kill()
                await asyncio.to_thread(process.wait)


async def run(output=None):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is required on PATH")
    secret = "integration-only-bff-context-" + "z" * 32
    async with disposable_postgres() as factory:
        async with factory() as session:
            async with session.begin():
                owner = User(
                    role=UserRole.ADMIN,
                    login_name="owner-bff-test",
                    password_hash=hash_password("test-owner-password-123"),
                )
                session.add(owner)
                agent = User(role=UserRole.AGENT, referral_code="BFF-LOGOUT-TEST")
                session.add(agent)
                await session.flush()
                agent_id = agent.id
                owner_id = owner.id
                session.add(Wallet(user_id=agent_id))
        backend_port, web_port = free_port(), free_port()
        backend_url, web_url = f"http://127.0.0.1:{backend_port}", f"http://127.0.0.1:{web_port}"
        server = uvicorn.Server(
            uvicorn.Config(
                create_app(replace(SETTINGS, bff_context_secret=secret), session_factory=factory),
                host="127.0.0.1",
                port=backend_port,
                log_level="error",
            )
        )
        task = asyncio.create_task(server.serve())
        while not server.started:
            if task.done():
                await task
            await asyncio.sleep(0.05)
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen(
                [
                    node,
                    str(ROOT / "web/node_modules/next/dist/bin/next"),
                    "start",
                    "-H",
                    "127.0.0.1",
                    "-p",
                    str(web_port),
                ],
                cwd=ROOT / "web",
                stdout=log,
                stderr=log,
                env={
                    **os.environ,
                    "AGENT_API_BASE_URL": backend_url,
                    "ADMIN_API_BASE_URL": backend_url,
                    "WEB_ORIGIN": web_url,
                    "BFF_CONTEXT_SECRET": secret,
                },
            )
            try:
                async with (
                    httpx.AsyncClient(base_url=web_url, timeout=20) as first,
                    httpx.AsyncClient(base_url=web_url, timeout=20) as second,
                ):
                    for _ in range(100):
                        if process.poll() is not None:
                            raise RuntimeError("Next server exited")
                        try:
                            ready = await first.get("/login/")
                            if ready.status_code == 200:
                                break
                            await asyncio.sleep(0.1)
                        except httpx.ConnectError:
                            await asyncio.sleep(0.1)
                    first_statuses = []
                    # Warm cookie, then fixed clients across the actual BFF gateway.
                    # At most one natural-minute boundary in this short batch.
                    for _ in range(41):
                        response = await first.post(
                            "/api/auth/admin/login",
                            json={"username": "wrong-bff-user", "password": "wrong"},
                            headers={"Origin": web_url},
                        )
                        first_statuses.append(response.status_code)
                        if response.status_code == 429:
                            break
                    good = await second.post(
                        "/api/auth/admin/login",
                        json={"username": "owner-bff-test", "password": "test-owner-password-123"},
                        headers={"Origin": web_url},
                    )
                    assert 20 <= len(first_statuses) - 1 <= 40
                    assert first_statuses[:-1] == [401] * (len(first_statuses) - 1)
                    assert first_statuses[-1] == 429, first_statuses
                    rate_key = hashlib.sha256(
                        (
                            "bff:" + first.cookies.get("rate_client") + ":/api/auth/admin/login"
                        ).encode()
                    ).hexdigest()
                    async with factory() as session:
                        assert (
                            await session.scalar(
                                text("SELECT max(attempts) FROM auth_rate_limits WHERE key=:key"),
                                {"key": rate_key},
                            )
                            == 21
                        )
                    assert good.status_code == 200, good.text
                    assert good.json() == {"ok": True, "role": "admin"}
                    assert "HttpOnly" in good.headers["set-cookie"]
                    overview = await second.get("/api/admin/overview")
                    assert overview.status_code == 200, overview.text
                    assert "accessToken" not in good.text
                    wallet = await second.get("/api/admin/wallet")
                    assert wallet.status_code == 200 and wallet.headers["x-account-id"] == str(
                        owner_id
                    )
                    oversized = await second.post(
                        "/api/auth/admin/login",
                        json={"username": "佣" * 3000, "password": "x"},
                        headers={"Origin": web_url},
                    )
                    assert oversized.status_code == 413
                    evidence = {
                        "gateway": "real Next -> FastAPI -> PostgreSQL",
                        "firstBrowser": {
                            "failedLogins": len(first_statuses) - 1,
                            "nextStatus": first_statuses[-1],
                        },
                        "secondBrowser": {
                            "loginStatus": good.status_code,
                            "overviewStatus": overview.status_code,
                        },
                        "tokenInBrowserJson": False,
                        "httpOnlyCookie": True,
                    }
                    evidence["walletIdentityHeaderForwarded"] = True
                    evidence["utf8BodyLimitStatus"] = oversized.status_code
                    evidence["recoveryWorkerFirstCycle"] = await check_worker(factory)
                    logout = await second.post(
                        "/api/auth/admin/logout", headers={"Origin": web_url}
                    )
                    assert logout.json() == {"ok": True, "sessionRevoked": True}
                    assert "admin_access_token" not in second.cookies
                    await second.post(
                        "/api/auth/admin/login",
                        json={"username": "owner-bff-test", "password": "test-owner-password-123"},
                        headers={"Origin": web_url},
                    )
                    assert "admin_access_token" in second.cookies
                    first.cookies.set(
                        "agent_access_token", token(agent_id), domain="127.0.0.1", path="/"
                    )
                    agent_wallet = await first.get("/api/agent/wallet")
                    assert agent_wallet.status_code == 200 and agent_wallet.headers[
                        "x-account-id"
                    ] == str(agent_id)
                    forbidden = await first.post(
                        "/api/agent/logout", headers={"Origin": "https://untrusted.invalid"}
                    )
                    assert forbidden.status_code == 403
                    assert "agent_access_token" in first.cookies
                    # Simulate the actual outage that used to leave HttpOnly credentials intact.
                    server.should_exit = True
                    await task
                    for client, role, path in (
                        (first, "agent", "/api/agent/logout"),
                        (second, "admin", "/api/auth/admin/logout"),
                    ):
                        result = await client.post(path, headers={"Origin": web_url})
                        assert result.status_code == 200, result.text
                        assert result.json() == {"ok": True, "sessionRevoked": False}
                        assert f"{role}_access_token" not in client.cookies
                        assert (await client.get(f"/api/{role}/overview")).status_code == 401
                    evidence["logout"] = {
                        "normalRevocation": True,
                        "invalidOriginRejected": True,
                        "upstreamOutageClearsBothRoleCookies": True,
                        "protectedRoutesAfterLogout": 401,
                    }
                    if output:
                        Path(output).write_text(
                            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n"
                        )
                    print(json.dumps(evidence, ensure_ascii=False))
            finally:
                process.terminate()
                try:
                    await asyncio.to_thread(process.wait, 10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    await asyncio.to_thread(process.wait)
                server.should_exit = True
                await task


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    asyncio.run(run(parser.parse_args().output))
