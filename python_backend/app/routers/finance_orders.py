import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select

from ..commission import process_order_commission
from ..errors import APIError
from ..models import (
    Order,
    User,
    UserRole,
)
from ..payments import (
    PaymentNotice,
    accept_payment_notice,
    verify_merchant_signature,
)
from ..schemas import (
    CommissionResult,
    OrderCreated,
)
from ..security import current_admin_id

router = APIRouter(tags=["financial lifecycle"])


class OrderBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    orderNo: str = Field(min_length=1, max_length=64)
    customerId: str = Field(min_length=1, max_length=128)
    promoterId: uuid.UUID
    totalAmount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    profitAmount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)


@router.post("/api/admin/orders", status_code=201, response_model=OrderCreated)
async def create_order(
    body: OrderBody, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    if body.profitAmount > body.totalAmount:
        raise APIError(400, "PROFIT_EXCEEDS_TOTAL")
    async with request.app.state.session_factory() as session:
        async with session.begin():
            # Lock against concurrent bind; the database trigger creates the snapshot.
            user = await session.scalar(
                select(User)
                .where(
                    User.id == body.promoterId,
                    User.role == UserRole.AGENT,
                    User.is_active.is_(True),
                )
                .with_for_update(read=True)
            )
            if not user:
                raise APIError(404, "AGENT_NOT_FOUND")
            prior = await session.scalar(select(Order).where(Order.order_no == body.orderNo))
            if prior:
                if (
                    prior.customer_id,
                    prior.promoter_id,
                    prior.total_amount,
                    prior.profit_amount,
                ) != (body.customerId, body.promoterId, body.totalAmount, body.profitAmount):
                    raise APIError(409, "ORDER_NUMBER_CONFLICT")
                return {"orderId": str(prior.id), "status": prior.payment_status.value}
            order = Order(
                order_no=body.orderNo,
                customer_id=body.customerId,
                promoter_id=body.promoterId,
                total_amount=body.totalAmount,
                profit_amount=body.profitAmount,
            )
            session.add(order)
            await session.flush()
            return {"orderId": str(order.id), "status": order.payment_status.value}


@router.post(
    "/api/payments/webhook", response_model=CommissionResult, response_model_exclude_unset=True
)
async def payment_webhook(
    request: Request, x_payment_timestamp: str = Header(""), x_payment_signature: str = Header("")
):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 16_384:
            raise APIError(413, "PAYLOAD_TOO_LARGE")
        chunks.append(chunk)
    raw = b"".join(chunks)
    verify_merchant_signature(
        request.app.state.settings.payment_webhook_secret,
        raw,
        x_payment_timestamp,
        x_payment_signature,
    )
    try:
        notice = PaymentNotice.model_validate_json(raw)
    except ValidationError as exc:
        raise APIError(400, "INVALID_PAYMENT_NOTICE") from exc
    return await accept_payment_notice(notice, request.app.state.session_factory)


@router.post(
    "/api/admin/orders/{order_id}/settle",
    response_model=CommissionResult,
    response_model_exclude_unset=True,
)
async def retry_settlement(
    order_id: uuid.UUID, request: Request, _admin: uuid.UUID = Depends(current_admin_id)
):
    try:
        return await process_order_commission(str(order_id), request.app.state.session_factory)
    except ValueError as exc:
        raise APIError(409, "ORDER_CANNOT_SETTLE", str(exc)) from exc
