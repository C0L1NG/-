"""Generate the browser response types from the FastAPI Pydantic models.

Run from any directory: python python_backend/tools/generate_ts_contracts.py [--check]
"""

import argparse
import json
import sys
import types
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Literal, Union, get_args, get_origin

from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python_backend"))

from app import schemas  # noqa: E402
from app.payments import PaymentNotice  # noqa: E402
from app.routers.agent import BindBody, WechatLoginBody  # noqa: E402
from app.routers.auth import AdminWechatBody, ExchangeBody, LoginBody  # noqa: E402
from app.routers.finance import (  # noqa: E402
    AccountBody,
    OrderBody,
    ReviewBody,
    VerificationBody,
    WithdrawalBody,
)

MODELS = (
    schemas.AgentOverview,
    schemas.Referral,
    schemas.TeamMember,
    schemas.TeamPage,
    schemas.AgentActivityItem,
    schemas.AgentActivityPage,
    schemas.AgentActivitySummary,
    schemas.LedgerItem,
    schemas.LedgerPage,
    schemas.ParentBinding,
    schemas.MiniProgramCode,
    schemas.WechatAgent,
    schemas.WechatLogin,
    schemas.AdminOverview,
    schemas.AgentNode,
    schemas.TreeRoot,
    schemas.TeamTree,
    schemas.AgentDetail,
    schemas.Person,
    schemas.PlatformSplit,
    schemas.AgentSplit,
    schemas.AuditItem,
    schemas.AuditPage,
    schemas.AgentProgress,
    schemas.NetworkNode,
    schemas.NetworkPage,
    schemas.WalletState,
    schemas.OperationsSummary,
    schemas.PayoutAccountData,
    schemas.WithdrawalData,
    schemas.PayoutAccountPage,
    schemas.WithdrawalPage,
    schemas.WithdrawalActionData,
    schemas.PayoutDetails,
    schemas.SessionLogin,
    schemas.LoginTicket,
    schemas.OrderCreated,
    schemas.CommissionResult,
    schemas.PaymentInboxData,
    schemas.PaymentInboxPage,
    schemas.PendingAccount,
    schemas.PendingAccountPage,
    schemas.APIErrorBody,
    OrderBody,
    AccountBody,
    WithdrawalBody,
    ReviewBody,
    VerificationBody,
    LoginBody,
    ExchangeBody,
    AdminWechatBody,
    BindBody,
    WechatLoginBody,
    PaymentNotice,
)
TARGET = ROOT / "web/lib/api-contract.generated.ts"


def ts_type(annotation: object) -> str:
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        values = list(dict.fromkeys(ts_type(item) for item in get_args(annotation)))
        return " | ".join(values)
    if origin is list:
        return f"{ts_type(get_args(annotation)[0])}[]"
    if origin is Literal:
        return " | ".join(json.dumps(item, ensure_ascii=False) for item in get_args(annotation))
    if annotation is type(None):
        return "null"
    if annotation is uuid.UUID:
        return "string"
    if annotation is Decimal:
        return "string | number"
    if annotation is str:
        return "string"
    if annotation in (int, float):
        return "number"
    if annotation is bool:
        return "boolean"
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation.__name__
    raise TypeError(f"Unsupported contract type: {annotation!r}")


def render() -> str:
    lines = [
        "// Generated from the backend Pydantic response and request models. Do not edit by hand.",
        "// Run: python python_backend/tools/generate_ts_contracts.py",
        "",
    ]
    for model in MODELS:
        lines.append(f"export type {model.__name__} = {{")
        for name, field in model.model_fields.items():
            optional = "?" if not field.is_required() else ""
            lines.append(f"  {name}{optional}: {ts_type(field.annotation)};")
        lines.extend(("};", ""))
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    desired = render()
    if args.check:
        if not TARGET.exists() or TARGET.read_text() != desired:
            raise SystemExit(f"Stale API types: run {Path(__file__).name} without --check")
        print("API types match Pydantic models")
    else:
        TARGET.write_text(desired)
        print(f"Wrote {TARGET}")
