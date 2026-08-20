"""Transactional email. MailHog catches everything in dev (http://localhost:8025)."""

from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from ..config import settings

log = logging.getLogger("blob.mail")


async def send_mail(to: str, subject: str, body: str) -> None:
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


async def send_invite(to: str, inviter_name: str, url: str, workspace: str) -> None:
    await send_mail(
        to,
        f"{inviter_name} invited you to {workspace}",
        f"{inviter_name} invited you to join {workspace}.\n\n"
        f"Accept the invitation:\n{url}\n\nThe link expires in a few days.",
    )


async def send_password_reset(to: str, url: str) -> None:
    await send_mail(
        to,
        "Reset your password",
        f"Use this link to choose a new password:\n{url}\n\n"
        "It expires in one hour. If you didn't ask for this, nothing has changed "
        "and you can ignore this email.",
    )
