import asyncio
import secrets
import time
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class WechatSession:
    open_id: str
    union_id: str | None = None


class WechatClient:
    def __init__(self, app_id: str, app_secret: str):
        self.app_id, self.app_secret = app_id, app_secret
        self.http = httpx.AsyncClient(timeout=10)
        self._token: tuple[str, float] | None = None
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self.http.aclose()

    async def code2session(self, code: str) -> WechatSession:
        response = await self.http.get("https://api.weixin.qq.com/sns/jscode2session", params={
            "appid": self.app_id, "secret": self.app_secret, "js_code": code,
            "grant_type": "authorization_code"})
        body = response.json()
        if not response.is_success or body.get("errcode") or not body.get("openid"):
            raise RuntimeError("WeChat login failed")
        return WechatSession(body["openid"], body.get("unionid"))

    async def _access_token(self) -> str:
        async with self._lock:
            if self._token and self._token[1] > time.monotonic() + 60:
                return self._token[0]
            response = await self.http.get("https://api.weixin.qq.com/cgi-bin/token", params={
                "grant_type": "client_credential", "appid": self.app_id, "secret": self.app_secret})
            body = response.json()
            if not response.is_success or body.get("errcode") or not body.get("access_token"):
                raise RuntimeError("WeChat token failed")
            self._token = (body["access_token"], time.monotonic() + body.get("expires_in", 7200))
            return self._token[0]

    async def get_unlimited_code(self, scene: str, page: str) -> tuple[bytes, str]:
        response = await self.http.post("https://api.weixin.qq.com/wxa/getwxacodeunlimit",
            params={"access_token": await self._access_token()},
            json={"scene": scene, "page": page, "width": 430, "check_path": True})
        content_type = response.headers.get("content-type", "application/octet-stream")
        if not response.is_success or "json" in content_type:
            raise RuntimeError("WeChat code generation failed")
        return response.content, content_type


def new_referral_code() -> str:
    return "AG" + secrets.token_hex(6).upper()
