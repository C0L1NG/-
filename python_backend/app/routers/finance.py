"""Stable router composition; financial domains own their individual HTTP handlers."""

from fastapi import APIRouter

from .finance_accounts import AccountBody as AccountBody
from .finance_accounts import AccountRejectionBody as AccountRejectionBody
from .finance_accounts import VerificationBody as VerificationBody
from .finance_accounts import router as accounts_router
from .finance_health import router as health_router
from .finance_orders import OrderBody as OrderBody
from .finance_orders import router as orders_router
from .finance_recovery import router as recovery_router
from .finance_withdrawals import ReviewBody as ReviewBody
from .finance_withdrawals import WithdrawalBody as WithdrawalBody
from .finance_withdrawals import router as withdrawals_router

router = APIRouter()
for domain in (orders_router, accounts_router, withdrawals_router, health_router, recovery_router):
    router.include_router(domain)
