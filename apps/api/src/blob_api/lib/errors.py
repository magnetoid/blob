"""Typed application errors that map cleanly onto HTTP responses.

The codes here are part of the client contract — `apps/web/src/lib/api.ts` unwraps
`{error: {code, message, field?}}` and branches on `status`. Do not rename them.
"""

from __future__ import annotations


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field


def unique_violation(exc: Exception) -> bool:
    """True when a write lost a race against a unique index.

    Lives here rather than beside any one caller because both the service layer and the
    plugin layer need it, and the plugin layer is below the services — a shared check on
    a Postgres error code is exactly what `lib/` is for.
    """
    code = getattr(getattr(exc, "orig", None), "sqlstate", None)
    return code == "23505" or "duplicate key value" in str(exc)


def bad_request(message: str, code: str = "bad_request") -> AppError:
    """The request is malformed or fails validation."""
    return AppError(400, code, message)


def unauthorized(message: str = "Sign in to continue.") -> AppError:
    """No valid session."""
    return AppError(401, "unauthorized", message)


def forbidden(message: str = "You don't have access to that.") -> AppError:
    """Signed in, but not allowed. Also used where existence itself is private."""
    return AppError(403, "forbidden", message)


def not_found(message: str = "That doesn't exist.") -> AppError:
    return AppError(404, "not_found", message)


def conflict(message: str, code: str = "conflict") -> AppError:
    return AppError(409, code, message)


def too_many_requests(message: str = "Too many attempts. Try again shortly.") -> AppError:
    return AppError(429, "rate_limited", message)
