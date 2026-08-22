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
    TRANSLATION_PROVIDER: Literal["disabled", "libretranslate", "deepl"] = "disabled"
    TRANSLATION_BASE_URL: str | None = None
    TRANSLATION_API_KEY: str | None = None
    TRANSLATION_TIMEOUT_SEC: float = 10.0

    # Hosting an agent from a repository. Disabled means agents can still be registered
    # as external apps — only the "and run it for me" half is off. Blob never holds the
    # Docker socket itself; the runner is whatever already owns that privilege.
    AGENT_RUNNER: Literal["disabled", "coolify"] = "disabled"
    #: Where the runner's API lives. Deliberately not COOLIFY_URL: Coolify injects that
    #: name into every container it runs, set to that container's own address, so a Blob
    #: deployed on Coolify would read its own URL and aim the runner at itself. The one
    #: environment where this feature is most likely to be used is the one where that
    #: name cannot be used.
    COOLIFY_API_URL: str | None = None
    COOLIFY_TOKEN: str | None = None
    COOLIFY_PROJECT_UUID: str | None = None
    COOLIFY_SERVER_UUID: str | None = None
    #: Which Docker destination on that server. Only required when the server has more
    #: than one — Coolify refuses the create outright in that case rather than picking,
    #: so it is optional here and sent only when set. Point it at the same destination
    #: Blob itself runs on, so an agent shares the network its workspace is reachable on.
    COOLIFY_DESTINATION_UUID: str | None = None
    COOLIFY_ENVIRONMENT: str = "production"
    AGENT_DEPLOY_TIMEOUT_SEC: float = 30.0

    # An AG-UI agent is called when it is mentioned and answers over an event stream.
    # Every one of these is a containment bound rather than a tuning knob: a mentioned
    # agent runs in the worker, so an agent that hangs or floods must cost a bounded
    # amount of somebody else's latency.
    #: Whole run, wall clock. After this the person gets "I couldn't finish that".
    AGUI_TIMEOUT_SEC: float = 120.0
    #: Between events. Catches an agent that opened a stream and then stopped talking.
    AGUI_READ_TIMEOUT_SEC: float = 30.0
    #: How much conversation the agent is given when it is mentioned outside a thread.
    AGUI_HISTORY_LIMIT: int = 30
    AGUI_MAX_EVENTS: int = 5_000
    AGUI_MAX_BYTES: int = 2 * 1024 * 1024

    @field_validator(
        "SMTP_USER",
        "SMTP_PASS",
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY",
        "WEB_DIST",
        "TRANSLATION_BASE_URL",
        "TRANSLATION_API_KEY",
        "COOLIFY_API_URL",
        "COOLIFY_TOKEN",
        "COOLIFY_PROJECT_UUID",
        "COOLIFY_SERVER_UUID",
        "COOLIFY_DESTINATION_UUID",
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
    def agent_hosting_enabled(self) -> bool:
        """Every piece has to be present, or a deploy fails halfway through."""
        return self.AGENT_RUNNER == "coolify" and all(
            (
                self.COOLIFY_API_URL,
                self.COOLIFY_TOKEN,
                self.COOLIFY_PROJECT_UUID,
                self.COOLIFY_SERVER_UUID,
            )
        )

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
