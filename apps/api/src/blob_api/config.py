"""Environment configuration, validated once at boot so misconfiguration fails loudly.

Mirrors the env contract of the TypeScript server exactly, so the same .env drives both
during the port.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    NODE_ENV: Literal["development", "test", "production"] = "development"
    PORT: int = 3000
    PUBLIC_URL: str = "http://localhost:5173"

    #: Where the built client lives. Set in the image; unset in development, where Vite
    #: serves the client itself and proxies /api and /ws here.
    WEB_DIST: str | None = None

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"

    SESSION_SECRET: str = Field(min_length=32)
    SESSION_TTL_DAYS: int = 30

    S3_ENDPOINT: str = "http://localhost:9000"
    S3_PUBLIC_ENDPOINT: str | None = None
    S3_REGION: str = "us-east-1"
    S3_BUCKET: str = "blob-files"
    S3_ACCESS_KEY: str = "blobadmin"
    S3_SECRET_KEY: str = "blobadmin123"
    S3_FORCE_PATH_STYLE: bool = True

    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_SECURE: bool = False
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    MAIL_FROM: str = "Blob <chat@example.com>"

    VAPID_PUBLIC_KEY: str | None = None
    VAPID_PRIVATE_KEY: str | None = None
    VAPID_SUBJECT: str = "mailto:admin@example.com"

    PLUGINS_DIR: str = "plugins"

    @field_validator(
        "SMTP_USER", "SMTP_PASS", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "WEB_DIST"
    )
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None

    @property
    def is_prod(self) -> bool:
        return self.NODE_ENV == "production"

    @property
    def is_test(self) -> bool:
        return self.NODE_ENV == "test"

    @property
    def s3_public_endpoint(self) -> str:
        return self.S3_PUBLIC_ENDPOINT or self.S3_ENDPOINT

    @property
    def push_enabled(self) -> bool:
        return bool(self.VAPID_PUBLIC_KEY and self.VAPID_PRIVATE_KEY)

    @property
    def sqlalchemy_url(self) -> str:
        """SQLAlchemy wants the driver named in the scheme; the env carries a plain URL."""
        url = self.DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://") :]
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
