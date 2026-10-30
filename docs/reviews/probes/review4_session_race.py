import asyncio
import json
import sys
from pathlib import Path
import httpx
import jwt

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "python_backend"), str(ROOT / "python_backend/tests")]
from postgres_support import disposable_postgres
from test_financial_lifecycle import SETTINGS, token
from app.factory import create_app
from app.models import User, UserRole, Wallet
from app.routers import auth


async def run_role(factory, role):
    async with factory() as s:
        async with s.begin():
            user = User(role=UserRole(role), referral_code="RACE-" + role)
            s.add(user)
            await s.flush()
            if role == "agent":
                s.add(Wallet(user_id=user.id))
            user_id = user.id
    app = create_app(SETTINGS, session_factory=factory)
    validated = asyncio.Event()
    proceed = asyncio.Event()
    original = auth.create_ticket

    async def paused_create_ticket(request, user_id):
        validated.set()
        await proceed.wait()
        return await original(request, user_id)

    auth.create_ticket = paused_create_ticket
    ticket_path = (
        "/api/auth/web-ticket" if role == "agent" else "/api/auth/admin/web-ticket"
    )
    logout_path = "/api/agent/logout" if role == "agent" else "/api/auth/admin/logout"
    header = {"Authorization": "Bearer " + token(user_id, role)}
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            pending = asyncio.create_task(client.post(ticket_path, headers=header))
            await asyncio.wait_for(validated.wait(), 5)
            logout = await client.post(logout_path, headers=header)
            invalid_old = await client.get(f"/api/{role}/overview", headers=header)
            proceed.set()
            ticket_response = await pending
            exchange = await client.post(
                "/api/auth/web/exchange",
                json={"ticket": ticket_response.json()["ticket"]},
            )
            new_token = exchange.json()["accessToken"]
            new_access = await client.get(
                f"/api/{role}/overview",
                headers={"Authorization": "Bearer " + new_token},
            )
            claims = jwt.decode(new_token, options={"verify_signature": False})
            return {
                "role": role,
                "logout_status": logout.status_code,
                "revoked_old_token_status": invalid_old.status_code,
                "ticket_after_logout_status": ticket_response.status_code,
                "exchange_after_logout_status": exchange.status_code,
                "new_token_version": claims["ver"],
                "new_access_after_logout_status": new_access.status_code,
            }
    finally:
        auth.create_ticket = original


async def main():
    async with disposable_postgres() as factory:
        result = [await run_role(factory, role) for role in ["agent", "admin"]]
        Path("/tmp/review4-session-race.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        )
        print(json.dumps(result, ensure_ascii=False))


asyncio.run(main())
