# Multi-stage: uv resolves and installs into a venv, the runtime image carries only that.
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
# Non-root, and the plugins directory is mounted read-only: installing a local plugin
# should be a deploy, not something the running app can do to itself.
RUN useradd --create-home --uid 10001 blob
COPY --from=builder --chown=blob:blob /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER blob
EXPOSE 3000
CMD ["uvicorn", "blob_api.main:app", "--host", "0.0.0.0", "--port", "3000"]
