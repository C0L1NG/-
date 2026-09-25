from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
from .db import make_session_factory
from .errors import APIError, api_error_handler
from .routers.admin import router as admin_router
from .routers.agent import auth_router, public_agent_router, router as agent_router
from .wechat import WechatClient


def create_app(settings: Settings, *, session_factory=None, wechat=None) -> FastAPI:
    settings.validate()
    engine = None
    if session_factory is None:
        session_factory, engine = make_session_factory(settings.database_url)
    if wechat is None and settings.wechat_app_id and settings.wechat_app_secret:
        wechat = WechatClient(settings.wechat_app_id, settings.wechat_app_secret)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if wechat is not None and hasattr(wechat, "close"):
            await wechat.close()
        if engine is not None:
            await engine.dispose()

    app = FastAPI(title="二级分销平台 API", version="2.0.0", lifespan=lifespan,
        description="与原 Fastify 路由和 JSON 契约兼容的 FastAPI 服务。")
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.wechat = wechat
    app.add_exception_handler(APIError, api_error_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _error: RequestValidationError):
        return JSONResponse({"statusCode": 400, "code": "FST_ERR_VALIDATION",
            "error": "Bad Request", "message": "Request validation failed"},
            status_code=400)

    app.include_router(auth_router)
    app.include_router(public_agent_router)
    app.include_router(agent_router)
    app.include_router(admin_router)
    return app
