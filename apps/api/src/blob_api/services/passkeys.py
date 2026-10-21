"""Passkeys: signing in with the device in your hand (M3 · B1, ADR 0032).

A passkey is a WebAuthn credential — a key pair whose private half never leaves the
person's device or their password manager — and Blob keeps only the public half. It is
the *person's*, like their password: one address, one set of passkeys, for every
workspace on this server, so signing in with one lands where a password would
(`accounts.find_for_login`), and the switcher does the rest.

Three uses, one ceremony each:

* **sign in** with a passkey alone — discoverable credentials, so no address is typed;
* **confirm it's you** before a sensitive action (ADR 0031) — the person's own passkeys;
* **a second step** after the password, for a person who has asked for one.

Every ceremony's challenge lives in Redis for five minutes and is spent once, bound to
what started it: a sign-in to nobody yet, a confirmation to the session asking, a second
step to the address whose password was just right. Blob asks for no attestation — which
brand of authenticator holds the key is not Blob's business, and checking it would only
let Blob refuse some.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, generate_user_handle
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from ..config import settings
from ..lib.errors import AppError, bad_request, conflict, not_found, unique_violation
from ..lib.ids import new_id, new_token
from ..lib.redis import redis

#: How long a ceremony may take, end to end: the browser's prompt, the person finding
#: their phone, the round trip. Past it the challenge is gone and they start again.
CEREMONY_SEC = 300

#: More passkeys than anybody keeps — a phone, a laptop, a key in a drawer — but a
#: ceiling, so a session cannot fill a table.
MAX_PER_PERSON = 20

Purpose = Literal["sign_in", "confirm", "two_step"]

#: What a password manager calls this server beside the key — "Save a passkey for Blob".
RP_NAME = "Blob"


def relying_party() -> tuple[str, str]:
    """This server as WebAuthn knows it: the host a passkey is bound to, and the origin
    a ceremony must come from. Both from `PUBLIC_URL`, never from a request."""
    parsed = urlparse(settings.PUBLIC_URL)
    host = parsed.hostname or "localhost"
    return host, f"{parsed.scheme}://{parsed.netloc}"


def refused(reason: str = "That passkey could not be checked. Try again.") -> AppError:
    return AppError(400, "passkey_refused", reason)


# ─── the person ───────────────────────────────────────────────────────────────


async def _handle(session: AsyncSession, email: str, *, create: bool) -> bytes | None:
    """The opaque id a passkey stores for its person. Random, per address, never the
    address itself: an authenticator shows it to nobody, but it is not Blob's to leak."""
    row = (
        await session.execute(
            text("SELECT user_handle FROM passkey_owners WHERE email = :email"),
            {"email": email},
        )
    ).fetchone()
    if row is not None:
        return bytes(row.user_handle)
    if not create:
        return None
    handle = generate_user_handle()
    await session.execute(
        text(
            """
            INSERT INTO passkey_owners (email, user_handle) VALUES (:email, :handle)
            ON CONFLICT (email) DO NOTHING
            """
        ),
        {"email": email, "handle": handle},
    )
    return await _handle(session, email, create=False)


async def count_for(session: AsyncSession, email: str) -> int:
    return int(
        (
            await session.execute(
                text("SELECT count(*) FROM passkeys WHERE email = :email"), {"email": email}
            )
        ).scalar_one()
    )


async def two_step_required(session: AsyncSession, email: str) -> bool:
    """Whether a right password is only half a sign-in for this person.

    Only while they still hold a passkey: a requirement with nothing left to meet it
    would be a lockout, and removing the last passkey refuses while it is on anyway.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT o.two_step
                  FROM passkey_owners o
                 WHERE o.email = :email
                   AND EXISTS (SELECT 1 FROM passkeys p WHERE p.email = o.email)
                """
            ),
            {"email": email},
        )
    ).fetchone()
    return bool(row and row.two_step)


async def set_two_step(session: AsyncSession, *, email: str, on: bool) -> None:
    if on and await count_for(session, email) == 0:
        raise bad_request("Add a passkey first: a second step needs something to ask for.")
    await _handle(session, email, create=True)
    await session.execute(
        text("UPDATE passkey_owners SET two_step = :on WHERE email = :email"),
        {"email": email, "on": on},
    )


# ─── adding one ───────────────────────────────────────────────────────────────


def _register_key(session_id: str) -> str:
    return f"passkey:register:{session_id}"


async def begin_registration(
    session: AsyncSession, *, email: str, display_name: str, session_id: str
) -> dict[str, Any]:
    """Options for `navigator.credentials.create`, as the JSON the browser parses."""
    if await count_for(session, email) >= MAX_PER_PERSON:
        raise bad_request(f"You already have {MAX_PER_PERSON} passkeys. Remove one first.")
    handle = await _handle(session, email, create=True)
    existing = await _credential_ids(session, email)
    rp_id, _origin = relying_party()
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=handle,
        user_name=email,
        user_display_name=display_name,
        timeout=CEREMONY_SEC * 1000,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        # Asking the browser not to make a second passkey in a place that already holds
        # one for this person, which it would otherwise do without a word.
        exclude_credentials=[PublicKeyCredentialDescriptor(id=raw) for raw in existing],
    )
    await redis.set(
        _register_key(session_id), bytes_to_base64url(options.challenge), ex=CEREMONY_SEC
    )
    parsed: dict[str, Any] = json.loads(options_to_json(options))
    return parsed


@dataclass(slots=True)
class Passkey:
    id: str
    name: str
    created_at: Any
    last_used_at: Any
    backed_up: bool


async def finish_registration(
    session: AsyncSession,
    *,
    email: str,
    session_id: str,
    credential: dict[str, Any],
    name: str | None,
) -> Passkey:
    challenge = await redis.getdel(_register_key(session_id))
    if not challenge:
        raise refused("That took too long. Start adding the passkey again.")
    rp_id, origin = relying_party()
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except WebAuthnException as error:
        raise refused() from error

    transports = [
        value
        for value in (credential.get("response") or {}).get("transports") or []
        if value in {transport.value for transport in AuthenticatorTransport}
    ]
    passkey_id = new_id()
    label = (name or "").strip()[:60] or "Passkey"
    try:
        async with session.begin_nested():
            await session.execute(
                text(
                    """
                    INSERT INTO passkeys
                           (id, email, credential_id, public_key, sign_count, transports,
                            aaguid, backed_up, name)
                    VALUES (:id, :email, :credential_id, :public_key, :sign_count,
                            :transports, :aaguid, :backed_up, :name)
                    """
                ),
                {
                    "id": passkey_id,
                    "email": email,
                    "credential_id": verified.credential_id,
                    "public_key": verified.credential_public_key,
                    "sign_count": verified.sign_count,
                    "transports": transports,
                    "aaguid": verified.aaguid,
                    "backed_up": verified.credential_backed_up,
                    "name": label,
                },
            )
    except Exception as error:
        if unique_violation(error):
            raise conflict("That passkey is already on your account.") from error
        raise
    return Passkey(
        id=passkey_id,
        name=label,
        created_at=None,
        last_used_at=None,
        backed_up=verified.credential_backed_up,
    )


async def _credential_ids(session: AsyncSession, email: str) -> list[bytes]:
    return [
        bytes(row.credential_id)
        for row in (
            await session.execute(
                text("SELECT credential_id FROM passkeys WHERE email = :email"),
                {"email": email},
            )
        ).fetchall()
    ]


# ─── the list ─────────────────────────────────────────────────────────────────


async def list_for(session: AsyncSession, email: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, name, created_at, last_used_at, backed_up
                      FROM passkeys WHERE email = :email ORDER BY created_at
                    """
                ),
                {"email": email},
            )
        ).fetchall()
    )


async def rename(session: AsyncSession, *, email: str, passkey_id: str, name: str) -> None:
    renamed = (
        await session.execute(
            text("UPDATE passkeys SET name = :name WHERE id = :id AND email = :email RETURNING id"),
            {"id": passkey_id, "email": email, "name": name.strip()[:60] or "Passkey"},
        )
    ).fetchone()
    if renamed is None:
        raise not_found("That passkey is not on your account.")


async def remove(session: AsyncSession, *, email: str, passkey_id: str) -> str:
    """Take a passkey off the account. Answers its credential id, base64url, so the
    browser can tell its password manager the key is no longer good here."""
    if await two_step_required(session, email) and await count_for(session, email) <= 1:
        raise bad_request(
            "Your sign-in asks for a passkey after the password, and this is your last one. "
            "Add another, or turn that off first."
        )
    removed = (
        await session.execute(
            text("DELETE FROM passkeys WHERE id = :id AND email = :email RETURNING credential_id"),
            {"id": passkey_id, "email": email},
        )
    ).fetchone()
    if removed is None:
        raise not_found("That passkey is not on your account.")
    return bytes_to_base64url(bytes(removed.credential_id))


# ─── using one ────────────────────────────────────────────────────────────────


def _flow_key(flow_id: str) -> str:
    return f"passkey:flow:{flow_id}"


async def begin_authentication(
    session: AsyncSession,
    *,
    purpose: Purpose,
    email: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """A challenge for `navigator.credentials.get`, and the flow id that spends it.

    A sign-in names nobody — the browser offers whichever passkeys it holds for this
    server — while a confirmation or a second step names the person, so their own keys
    are the only ones offered and the only ones that will be accepted.
    """
    rp_id, _origin = relying_party()
    allow: list[PublicKeyCredentialDescriptor] = []
    if purpose != "sign_in":
        if email is None:
            raise refused()
        allow = [
            PublicKeyCredentialDescriptor(id=raw) for raw in await _credential_ids(session, email)
        ]
        if not allow:
            raise bad_request("There is no passkey on your account yet.")
    options = generate_authentication_options(
        rp_id=rp_id,
        timeout=CEREMONY_SEC * 1000,
        allow_credentials=allow,
        # A passkey alone has to be two things at once — the device, and the face or PIN
        # that unlocked it. After a password, the device is the second thing.
        user_verification=(
            UserVerificationRequirement.PREFERRED
            if purpose == "two_step"
            else UserVerificationRequirement.REQUIRED
        ),
    )
    flow_id = new_token()
    await redis.set(
        _flow_key(flow_id),
        json.dumps(
            {
                "challenge": bytes_to_base64url(options.challenge),
                "purpose": purpose,
                "email": email,
                "session_id": session_id,
                "user_id": user_id,
            }
        ),
        ex=CEREMONY_SEC,
    )
    parsed: dict[str, Any] = json.loads(options_to_json(options))
    return flow_id, parsed


@dataclass(slots=True, frozen=True)
class Proven:
    """Whose passkey answered, and what the flow it answered was for."""

    email: str
    purpose: Purpose
    #: The session a confirmation was for; the account a second step was for.
    session_id: str | None
    user_id: str | None


async def finish_authentication(
    session: AsyncSession, *, flow_id: str, credential: dict[str, Any], purpose: Purpose
) -> Proven:
    raw = await redis.getdel(_flow_key(flow_id))
    if not raw:
        raise refused("That took too long. Try again.")
    flow = json.loads(raw)
    if flow["purpose"] != purpose:
        raise refused()
    try:
        credential_id = base64url_to_bytes(str(credential.get("rawId") or credential.get("id")))
    except Exception as error:
        raise refused() from error
    row = (
        await session.execute(
            text(
                """
                SELECT p.id, p.email, p.public_key, p.sign_count, o.user_handle
                  FROM passkeys p
                  JOIN passkey_owners o ON o.email = p.email
                 WHERE p.credential_id = :credential_id
                """
            ),
            {"credential_id": credential_id},
        )
    ).fetchone()
    if row is None:
        # Removed here, or never added: the person's password manager still offers it.
        raise AppError(400, "passkey_unknown", "That passkey is no longer on any account here.")
    if flow["email"] is not None and row.email.lower() != str(flow["email"]).lower():
        raise refused("That passkey belongs to someone else.")
    handle = (credential.get("response") or {}).get("userHandle")
    if handle and base64url_to_bytes(handle) != bytes(row.user_handle):
        raise refused()

    rp_id, origin = relying_party()
    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(flow["challenge"]),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=bytes(row.public_key),
            credential_current_sign_count=int(row.sign_count),
            require_user_verification=purpose != "two_step",
        )
    except WebAuthnException as error:
        raise refused() from error

    await session.execute(
        text(
            """
            UPDATE passkeys
               SET sign_count = :count, last_used_at = now(), backed_up = :backed_up
             WHERE id = :id
            """
        ),
        {
            "id": row.id,
            "count": verified.new_sign_count,
            "backed_up": verified.credential_backed_up,
        },
    )
    return Proven(
        email=str(row.email),
        purpose=purpose,
        session_id=flow.get("session_id"),
        user_id=flow.get("user_id"),
    )


__all__ = [
    "CEREMONY_SEC",
    "Passkey",
    "Proven",
    "begin_authentication",
    "begin_registration",
    "finish_authentication",
    "finish_registration",
    "list_for",
    "relying_party",
    "remove",
    "rename",
    "set_two_step",
    "two_step_required",
]
