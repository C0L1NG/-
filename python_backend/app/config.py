from dataclasses import dataclass
import os
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
