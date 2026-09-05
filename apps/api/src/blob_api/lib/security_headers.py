"""The response headers every answer carries, and the one that took thought.

Until this existed the only `Content-Security-Policy` in the codebase was on a feedback
snapshot — one route out of a hundred and forty. Everything else went out with no CSP, no
`nosniff`, no referrer policy and no frame-ancestors rule, which for a product whose whole
point is that untrusted agents write into it is the wrong default. It also blocks the one
feature waiting on it: an HTML preview an agent publishes cannot be shown in a page that
has no policy of its own.

**What the policy has to allow, and why each line is there.**

- `script-src 'self'`. The client is a Vite bundle on this origin. The theme bootstrap
  that used to be inline in `index.html` moved to `/theme-boot.js` for exactly this: a
  hash would change on every build and a nonce needs a server-rendered page, and Blob has
  neither.
- `style-src 'self' 'unsafe-inline'`. React's `style={{}}` props are inline style
  attributes, and the codebase uses them everywhere. `'unsafe-inline'` on styles admits
  an exfiltration channel in theory (a crafted stylesheet can leak attribute values) and
  nothing else; scripts stay locked.
- `img-src` and `media-src` allow `https:`. Link previews show the page's own `og:image`,
  which is wherever the page keeps it, and attachments are served by a 302 to object
  storage — CSP checks the redirect target, so the storage origin has to be allowed. An
  image is not code; a wide `img-src` costs nothing scripts could exploit.
- `connect-src` allows the storage origin. Uploads are a presigned PUT straight from the
  browser to object storage; the API never sees the bytes. Blocking that origin would make
  every upload fail with a console message nobody reads.
- `frame-src 'self'`. Feedback snapshots are same-origin iframes, and an agent's HTML
  preview will be a sandboxed `srcdoc` frame — which the browser treats as same-origin
  for the purpose of this directive.
- `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Nobody embeds a workspace.

The Swagger and ReDoc pages load their UI from a CDN, so they get every header but the
CSP. A route that sets its own policy (the feedback snapshot) keeps it: this only fills
in what is missing, never overrides.

`SECURITY_HEADERS=false` turns the whole thing off, for an operator who fronts Blob with a
proxy that sets its own. `CSP_EXTRA_SOURCES` adds hosts to `connect-src` and `img-src`
for a deployment whose storage or previews live somewhere this cannot infer.
"""

from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import urlparse

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..config import settings

#: Paths whose UI comes from a CDN. They get every header but the policy.
CSP_EXEMPT_PREFIXES = ("/docs", "/redoc", "/openapi.json")

HSTS = "max-age=31536000"


def _origin(url: str | None) -> str | None:
    """`scheme://host[:port]` of a URL, or None if it has no host."""
    if not url:
        return None
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.hostname:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _socket_origin(public_url: str) -> str | None:
    origin = _origin(public_url)
    if origin is None:
        return None
    scheme = "wss" if origin.startswith("https") else "ws"
    return f"{scheme}://{urlparse(origin).netloc}"


def content_security_policy(
    *,
    public_url: str,
    storage_origin: str | None,
    extra_sources: Iterable[str] = (),
) -> str:
    """The policy for the app and the API, as one string."""
    extra = [source.strip() for source in extra_sources if source.strip()]
    connect = ["'self'"]
    socket = _socket_origin(public_url)
    if socket:
        # `'self'` covers same-origin WebSockets in every current browser; the explicit
        # scheme is for the ones a self-hosted team still has around.
        connect.append(socket)
    if storage_origin and storage_origin not in connect:
        connect.append(storage_origin)
    connect.extend(source for source in extra if source not in connect)
    images = ["'self'", "data:", "blob:", "https:"]
    images.extend(source for source in extra if source not in images)

    return "; ".join(
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            f"img-src {' '.join(images)}",
            "media-src 'self' blob: https:",
            "font-src 'self' data:",
            f"connect-src {' '.join(connect)}",
            "worker-src 'self'",
            "manifest-src 'self'",
            "frame-src 'self'",
        ]
    )


def security_headers(*, path: str, secure: bool, existing: MutableHeaders) -> dict[str, str]:
    """What to add to a response, given what it already carries."""
    wanted: dict[str, str] = {
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-frame-options": "DENY",
        # Microphone stays available to this origin for voice notes; nothing else is.
        "permissions-policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
    }
    if secure:
        wanted["strict-transport-security"] = HSTS
    if not path.startswith(CSP_EXEMPT_PREFIXES):
        wanted["content-security-policy"] = content_security_policy(
            public_url=settings.PUBLIC_URL,
            storage_origin=_origin(settings.s3_public_endpoint),
            extra_sources=settings.CSP_EXTRA_SOURCES.split(),
        )
    # Fill in, never override: a route that set its own policy knows something this does
    # not (the feedback snapshot's `default-src 'none'` is stricter than ours, on purpose).
    return {name: value for name, value in wanted.items() if name not in existing}


class SecurityHeadersMiddleware:
    """Pure ASGI, for the same reason `SessionMiddleware` is: `BaseHTTPMiddleware`
    interferes with streaming responses and background tasks."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not settings.SECURITY_HEADERS:
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        # uvicorn runs with --proxy-headers, so behind the proxy `scheme` is what the
        # person's browser used. HSTS on a plain-http dev server would be a footgun.
        secure = scope.get("scheme") == "https"

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in security_headers(
                    path=path, secure=secure, existing=headers
                ).items():
                    headers.append(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


__all__ = [
    "CSP_EXEMPT_PREFIXES",
    "SecurityHeadersMiddleware",
    "content_security_policy",
    "security_headers",
]
