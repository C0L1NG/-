import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    jwt_issuer: str
    jwt_audience: str
    admin_jwt_audience: str
    referral_base_url: str
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    payment_webhook_secret: str = ""
    secure_cookies: bool = True
    admin_wechat_app_id: str = ""
    admin_wechat_app_secret: str = ""
    bff_context_secret: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        values = cls(
            database_url=os.getenv("DATABASE_URL", ""),
            jwt_secret=os.getenv("JWT_SECRET", ""),
            jwt_issuer=os.getenv("JWT_ISSUER", ""),
            jwt_audience=os.getenv("JWT_AUDIENCE", ""),
            admin_jwt_audience=os.getenv("ADMIN_JWT_AUDIENCE", "admin-portal"),
            referral_base_url=os.getenv("AGENT_REFERRAL_BASE_URL", ""),
            wechat_app_id=os.getenv("WECHAT_APP_ID", ""),
            wechat_app_secret=os.getenv("WECHAT_APP_SECRET", ""),
            payment_webhook_secret=os.getenv("PAYMENT_WEBHOOK_SECRET", ""),
            secure_cookies=os.getenv("COOKIE_SECURE", "true").lower() != "false",
            admin_wechat_app_id=os.getenv("ADMIN_WECHAT_APP_ID", ""),
            admin_wechat_app_secret=os.getenv("ADMIN_WECHAT_APP_SECRET", ""),
            bff_context_secret=os.getenv("BFF_CONTEXT_SECRET", ""),
        )
        values.validate()
        return values

    def validate(self) -> None:
        if not self.database_url.startswith(("postgresql://", "postgresql+asyncpg://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must have at least 32 characters")
        if not self.jwt_issuer or not self.jwt_audience or not self.admin_jwt_audience:
            raise ValueError("JWT issuer and both audiences are required")
        url = urlsplit(self.referral_base_url)
        if url.scheme != "https" and not (url.scheme == "http" and url.hostname == "localhost"):
            raise ValueError("AGENT_REFERRAL_BASE_URL must use HTTPS (localhost may use HTTP)")

        for label, app_id, secret in (
            ("WECHAT", self.wechat_app_id, self.wechat_app_secret),
            ("ADMIN_WECHAT", self.admin_wechat_app_id, self.admin_wechat_app_secret),
        ):
            if bool(app_id) != bool(secret):
                raise ValueError(
                    f"{label}_APP_ID and {label}_APP_SECRET must be configured together"
                )
        if self.bff_context_secret and len(self.bff_context_secret) < 32:
            raise ValueError("BFF_CONTEXT_SECRET must have at least 32 characters")
        if self.payment_webhook_secret and len(self.payment_webhook_secret) < 32:
            raise ValueError(
                "PAYMENT_WEBHOOK_SECRET must have at least 32 characters when configured"
            )
