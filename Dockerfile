# One image, one origin.
#
# The client and the API ship together and are served from the same host, so `/`, `/api`
# and `/ws` share an origin: the session cookie works with no CORS, and a proxy in front
# has exactly one service to route. Build context is the repo root.

# ─── 1. the client ────────────────────────────────────────────────────────────
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src

# Manifests first: dependencies only reinstall when they actually change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @blob/web build

# ─── 2. the server's dependencies ─────────────────────────────────────────────
FROM python:3.12-slim AS api
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY apps/api/ ./
RUN uv sync --frozen --no-dev

# ─── 3. what actually runs ────────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Non-root, and PLUGINS_DIR is mounted read-only: installing a local plugin should be a
# deploy, not something the running app can do to itself.
RUN useradd --create-home --uid 10001 blob

COPY --from=api --chown=blob:blob /app /app
COPY --from=web --chown=blob:blob /src/apps/web/dist /app/web
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/blob-entrypoint

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_DIST=/app/web \
    PORT=3000

USER blob
EXPOSE 3000

# Liveness only — /healthz touches nothing. /readyz is the one that checks Postgres and
# Redis, and it is deliberately not this, or a database blip would restart the app
# instead of waiting for the database to come back.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:3000/healthz',timeout=4)"]

ENTRYPOINT ["blob-entrypoint"]

# --proxy-headers is not optional behind a reverse proxy: without it every request
# appears to come from the proxy, so one person failing logins rate-limits everybody and
# every audit row records the same address. The container is only reachable from the
# proxy network, which is what makes trusting the header safe here.
CMD ["uvicorn", "blob_api.main:app", \
     "--host", "0.0.0.0", "--port", "3000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--no-server-header"]
