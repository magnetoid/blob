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

    TRANSLATION_PROVIDER: Literal["disabled", "libretranslate", "deepl"] = "disabled"
    TRANSLATION_BASE_URL: str | None = None
    TRANSLATION_API_KEY: str | None = None
    TRANSLATION_TIMEOUT_SEC: float = 10.0

    # The model behind the agent Blob runs itself. Every other agent brings its own key,
    # because every other agent is somebody else's program; this one is Blob's, so the
    # key is the server's.
    #
    # "disabled" is the default and a supported way to run: a workspace with no model
    # keeps every agent it installed and simply has no built-in one. Nothing about that
    # is an error state, so nothing degraded is offered in the UI and nothing 500s.
    LLM_PROVIDER: Literal["disabled", "anthropic", "openai"] = "disabled"
    LLM_API_KEY: str | None = None
    #: Override for a proxy or an OpenAI-compatible server run locally. The provider
    #: still decides the request shape; this only moves the host.
    LLM_BASE_URL: str | None = None
    #: Empty means the provider's default in `lib/llm.py`, which is a current model
    #: rather than a cheap one — the built-in agent is the product's first impression.
    LLM_MODEL: str | None = None
    LLM_MAX_TOKENS: int = 2_048
    LLM_TIMEOUT_SEC: float = 120.0
    LLM_READ_TIMEOUT_SEC: float = 60.0

    # Hosting an agent from a repository. Disabled means agents can still be registered
    # as external apps — only the "and run it for me" half is off. Blob never holds the
    # Docker socket itself; the runner is whatever already owns that privilege.
    #: The commit this server is running, when the host tells it.
    #:
    #: Coolify sets `SOURCE_COMMIT` on the container it deploys, and most CI systems set
    #: one of the others. It is here because the *client* cannot always find out for
    #: itself: the bundle stamps its own commit at build time from the repository, and a
    #: build host that ships a source tree without `.git` — which is what happens here —
    #: leaves it blank. The server is told by whoever deployed it, so it is the one that
    #: knows, and "What's new" asks it.
    SOURCE_COMMIT: str | None = None

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

    # A terminal inside a hosted agent's container, for the setup that is not a form: a
    # device-code login, a prompt file, a broken install. Blob never holds the Docker
    # socket for this — it holds an SSH key that the far end's forced command confines to
    # one `docker exec`. See plugins/shell.py and docs/agent-terminal.md.
    AGENT_SHELL: Literal["disabled", "ssh"] = "disabled"
    AGENT_SHELL_HOST: str | None = None
    AGENT_SHELL_PORT: int = 22
    AGENT_SHELL_USER: str = "root"
    #: The private key, inline. Escaped newlines are accepted, because a key pasted into
    #: a dashboard field arrives that way about half the time.
    AGENT_SHELL_KEY: str | None = None
    #: What the host must prove it is: an `ssh-keyscan` line, or the `type key` half of
    #: one. Required — see the module docstring for why there is no way to skip it.
    AGENT_SHELL_HOST_KEY: str | None = None
    AGENT_SHELL_CONNECT_TIMEOUT_SEC: float = 15.0
    #: A terminal nobody is typing at is a held connection and an open root shell. Closed
    #: after this long with no input, which is a session an operator walked away from.
    AGENT_SHELL_IDLE_SEC: float = 900.0
    #: Wall clock, regardless of activity. A long-running job belongs in the agent, not in
    #: a browser tab that has to stay open.
    AGENT_SHELL_MAX_SEC: float = 4 * 60 * 60.0
    #: Concurrent terminals per process. Each is an SSH connection and a PTY.
    AGENT_SHELL_MAX_SESSIONS: int = 8

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
    #: The hard wall on one run, idle or not. The idle timeouts above catch an agent
    #: that stopped talking; this catches one that keeps talking forever — and it is
    #: what lets real multi-minute agent work exist at all, where the old shape made
    #: AGUI_TIMEOUT_SEC a 120-second ceiling on the whole run.
    AGUI_MAX_RUN_SEC: float = 600.0
    #: Allow an app endpoint on a private address, over plain HTTP.
    #:
    #: Off by default and it should stay off on anything public: the guard it relaxes is
    #: what stops an admin registering an app URL that makes this server fetch its own
    #: network — a database, a Redis, a cloud metadata endpoint.
    #:
    #: It exists because self-hosting has a case the guard was not written for. An agent
    #: running in a container beside this one, on a network only these two share, is
    #: reached the same way Postgres and MinIO are, and requiring a public hostname and a
    #: certificate for that hop means requiring public DNS and a working ACME pipeline to
    #: talk to something one hop away. Turning this on is a statement that the operator
    #: controls the network the app sits on.
    AGENT_ALLOW_PRIVATE_ENDPOINTS: bool = False

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
        "AGENT_SHELL_HOST",
        "AGENT_SHELL_KEY",
        "AGENT_SHELL_HOST_KEY",
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
    def agent_shell_enabled(self) -> bool:
        """All four, or off.

        The host key is in here rather than checked at connect time so that a server
        missing it reports "the terminal is not set up" — which is true and actionable —
        instead of offering a button that fails with a host-key error every time, which
        reads as an attack rather than as a blank field.
        """
        return self.AGENT_SHELL == "ssh" and all(
            (self.AGENT_SHELL_HOST, self.AGENT_SHELL_KEY, self.AGENT_SHELL_HOST_KEY)
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
