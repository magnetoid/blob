"""Transactional email. MailHog catches everything in dev (http://localhost:8025).

A dead mail server must never fail the request that triggered it — an invitation whose
link is on screen is still an invitation — so sending swallows its failure. What it must
not do is *hide* it: `send_mail` reports whether the message actually went, the invite
route passes that on, and `probe` answers the operator's question directly. A server
whose SMTP host points at nothing accepted every invitation and delivered none of them,
and the only trace was a warning in a log nobody was reading.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from ..config import settings

log = logging.getLogger("blob.mail")


async def send_mail(to: str, subject: str, body: str) -> bool:
    """Send it, and say whether it went. Never raises."""
    message = EmailMessage()
    message["From"] = settings.MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            use_tls=settings.SMTP_SECURE,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
        )
    except Exception:
        # A dead mail server must not fail the request that triggered it; the invite
        # link is also returned in the response, and password reset is retryable.
        log.warning("could not send mail to %s", to, exc_info=True)
        return False
    return True


async def send_invite(to: str, inviter_name: str, url: str, workspace: str) -> bool:
    return await send_mail(
        to,
        f"{inviter_name} invited you to {workspace}",
        f"{inviter_name} invited you to join {workspace}.\n\n"
        f"Accept the invitation:\n{url}\n\nThe link expires in a few days.",
    )


async def send_password_reset(to: str, url: str) -> bool:
    return await send_mail(
        to,
        "Reset your password",
        f"Use this link to choose a new password:\n{url}\n\n"
        "It expires in one hour. If you didn't ask for this, nothing has changed "
        "and you can ignore this email.",
    )


#: How long the health probe waits before calling it unreachable. An admin refreshing a
#: page will not wait, and a mail server that takes longer than this to say hello is not
#: going to deliver an invitation while somebody watches either.
PROBE_TIMEOUT_SEC = 3.0


async def probe() -> str:
    """Whether mail could go out at all: "ok", "unreachable", or "unconfigured".

    Opens a connection and says nothing — no message, no authentication, so it cannot
    send anything by accident and needs no credentials to answer.
    """
    if not settings.SMTP_HOST:
        return "unconfigured"
    client = aiosmtplib.SMTP(
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        use_tls=settings.SMTP_SECURE,
        timeout=PROBE_TIMEOUT_SEC,
    )
    try:
        await client.connect()
        await client.quit()
    except Exception as error:
        log.info(
            "mail is not reachable at %s:%s (%s)", settings.SMTP_HOST, settings.SMTP_PORT, error
        )
        return "unreachable"
    return "ok"


__all__ = ["probe", "send_invite", "send_mail", "send_password_reset"]
