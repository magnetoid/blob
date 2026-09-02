# One image, one origin.
#
# The client and the API ship together and are served from the same host, so `/`, `/api`
# and `/ws` share an origin: the session cookie works with no CORS, and a proxy in front
# has exactly one service to route. Build context is the repo root.

# ─── 1. the client ────────────────────────────────────────────────────────────
FROM node:22-alpine AS web
# The prompt is what corepack does instead of downloading when no TTY says otherwise,
# which in a build is a hang rather than a question.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
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

# The history, for the build stamp on the "What's new" page — see `apps/web/vite.config.ts`.
#
# Copied through a glob rather than by name, and this is the load-bearing part: `COPY .git`
# *fails the build* on any host that does not put a repository in the context, and a page
# that names the running build is not worth a deploy that cannot happen. A COPY needs one
# source to match, `package.json` always does, and `.gi[t]` comes along when it exists and
# is silently absent when it does not. `HEAD` is what says which of those happened —
# COPY of a directory lands its *contents*, so the `.git` name does not survive the copy.
#
# Where it is absent the stamp falls back to SOURCE_COMMIT, which is what Coolify and most
# CI hand down, and failing that the page says nothing rather than guessing.
COPY package.jso[n] .gi[t] /gitsrc/
RUN if [ -f /gitsrc/HEAD ]; then \
      mkdir -p /src/.git && cp -a /gitsrc/. /src/.git/ && rm -f /src/.git/package.json; \
    fi; \
    rm -rf /gitsrc

ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
# git is not in the base image, and a checkout owned by another uid is one git refuses to
# read at all unless it is told that is expected.
RUN apk add --no-cache git \
    && git config --global --add safe.directory /src \
    && pnpm --filter @blob/web build

# ─── 2. the server's dependencies ─────────────────────────────────────────────
FROM python:3.12-slim AS api
# Pinned to the minor that wrote uv.lock: the lockfile is revision 3, and an older uv
# refuses to read it rather than resolving something different.
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
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
