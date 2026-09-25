from fastapi import Request
from fastapi.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message


async def api_error_handler(_request: Request, error: APIError) -> JSONResponse:
    body = {"code": error.code}
    if error.code == "FST_ERR_VALIDATION":
        body = {"statusCode": 400, "code": error.code, "error": "Bad Request"}
    if error.message is not None:
        body["message"] = error.message
    return JSONResponse(body, status_code=error.status_code, headers={"Cache-Control": "no-store"})
