import logging
import re
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Settings
from .db import make_session_factory
from .errors import APIError, api_error_handler
from .rate_limits import check_login_limit
from .routers.admin import router as admin_router
from .routers.agent import auth_router, public_agent_router
from .routers.agent import router as agent_router
from .routers.auth import router as login_router
from .routers.finance import router as finance_router
from .schemas import APIErrorBody
from .security import hash_password
from .wechat import WechatClient

logger = logging.getLogger("commission.api")


def create_app(
    settings: Settings, *, session_factory=None, wechat=None, admin_wechat=None
) -> FastAPI:
    settings.validate()
    engine = None
    if session_factory is None:
        session_factory, engine = make_session_factory(settings.database_url)
    if wechat is None and settings.wechat_app_id and settings.wechat_app_secret:
        wechat = WechatClient(settings.wechat_app_id, settings.wechat_app_secret)
    if admin_wechat is None and settings.admin_wechat_app_id and settings.admin_wechat_app_secret:
        admin_wechat = WechatClient(settings.admin_wechat_app_id, settings.admin_wechat_app_secret)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if wechat is not None and hasattr(wechat, "close"):
            await wechat.close()
        if admin_wechat is not None and hasattr(admin_wechat, "close"):
            await admin_wechat.close()
        if engine is not None:
            await engine.dispose()

    app = FastAPI(
        title="二级分销平台 API",
        version="2.0.0",
        lifespan=lifespan,
        responses={
            status: {"model": APIErrorBody}
            for status in (400, 401, 403, 404, 409, 429, 500, 501, 502, 503)
        },
        description="与原 Fastify 路由和 JSON 契约兼容的 FastAPI 服务。",
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.wechat = wechat
    app.state.admin_wechat = admin_wechat
    app.state.dummy_password_hash = hash_password("dummy-account-" + uuid.uuid4().hex)
    app.add_exception_handler(APIError, api_error_handler)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming_id = request.headers.get("x-request-id", "")
        request_id = incoming_id if re.fullmatch(r"[a-f0-9]{32}", incoming_id) else uuid.uuid4().hex
        start = time.monotonic()
        if request.method not in {"GET", "HEAD", "OPTIONS"} and not request.headers.get(
            "authorization"
        ):
            if request.cookies.get("agent_access_token") or request.cookies.get(
                "admin_access_token"
            ):
                if request.headers.get("origin") != str(request.base_url).rstrip("/"):
                    return JSONResponse(
                        {"code": "INVALID_ORIGIN"},
                        status_code=403,
                        headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
                    )
        try:
            await check_login_limit(request)
            response = await call_next(request)
        except APIError as exc:
            response = await api_error_handler(request, exc)
            if exc.status_code == 429:
                response.headers["Retry-After"] = "60"
        except httpx.HTTPError:
            response = JSONResponse(
                {
                    "code": "UPSTREAM_UNAVAILABLE",
                    "message": "External service is temporarily unavailable",
                },
                status_code=502,
            )
        except IntegrityError:
            response = JSONResponse(
                {"code": "DATA_CONFLICT", "message": "Conflicting financial or identity record"},
                status_code=409,
            )
        except Exception as exc:
            logger.error(
                "request_failed request_id=%s error_type=%s path=%s",
                request_id,
                type(exc).__name__,
                request.url.path,
            )
            response = JSONResponse(
                {"code": "INTERNAL_SERVER_ERROR", "message": "Service is temporarily unavailable"},
                status_code=500,
            )
        response.headers["X-Request-ID"] = request_id
        response.headers["Cache-Control"] = "no-store"
        logger.info(
            "request request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            (time.monotonic() - start) * 1000,
        )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, error: StarletteHTTPException):
        codes = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
        return JSONResponse(
            {"code": codes.get(error.status_code, "HTTP_ERROR")},
            status_code=error.status_code,
            headers=error.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _error: RequestValidationError):
        return JSONResponse(
            {
                "statusCode": 400,
                "code": "FST_ERR_VALIDATION",
                "error": "Bad Request",
                "message": "Request validation failed",
            },
            status_code=400,
        )

    app.include_router(auth_router)
    app.include_router(login_router)
    app.include_router(finance_router)
    app.include_router(public_agent_router)
    app.include_router(agent_router)
    app.include_router(admin_router)

    def openapi():
        if app.openapi_schema is None:
            schema = get_openapi(
                title=app.title, version=app.version, description=app.description, routes=app.routes
            )
            # Validation is deliberately 400 to retain the existing API contract.
            for path in schema["paths"].values():
                for operation in path.values():
                    if isinstance(operation, dict):
                        operation.get("responses", {}).pop("422", None)
            app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = openapi
    return app
