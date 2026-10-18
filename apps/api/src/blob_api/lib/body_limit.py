"""One ceiling on every request body, before anything reads one.

Each route that reads a body already has a limit of its own — a message is 12,000
characters, a calls webhook 64 KB, a feedback snapshot 2 MB — but every one of them is
checked *after* the body has been read into memory and parsed. With nothing in front of
them, a single request with a gigabyte `Content-Length` was read in full before the first
validator said no, and a few of those at once is the process. This answers 413 first.

Ten megabytes, because the largest body anything here legitimately accepts is the
feedback report — a 2 MB page snapshot plus its console log, which JSON escaping can
inflate several times over — and the limit has to sit above every honest request rather
than at the size of the typical one. Uploads never come through this process at all:
they are presigned PUTs straight to object storage.

Pure ASGI, like `SessionMiddleware`, because `BaseHTTPMiddleware` interferes with
streaming. A declared length is refused before the app runs, and the server's parser
will not deliver more than was declared. A body sent without one (chunked) is counted
as it arrives; when it passes the limit the app is told the client went away and the
caller gets the 413 instead of whatever the app would have said.
"""

from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: Read at call time, so a test can lower it without rebuilding the app.
MAX_BODY_BYTES = 10 * 1024 * 1024


def _too_large() -> JSONResponse:
    return JSONResponse(
        {"error": {"code": "payload_too_large", "message": "That request is too large."}},
        status_code=413,
    )


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = MAX_BODY_BYTES
        declared: int | None = None
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    declared = None
                break

        if declared is not None:
            if declared > limit:
                await _too_large()(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        received = 0
        over = False
        started = False

        async def counting_receive() -> Message:
            nonlocal received, over
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    over = True
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if over and not started:
                # Whatever the app makes of a vanished client is not the answer; the
                # 413 below is.
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if not over:
                raise
        if over and not started:
            await _too_large()(scope, receive, send)


__all__ = ["MAX_BODY_BYTES", "BodyLimitMiddleware"]
