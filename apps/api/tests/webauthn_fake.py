"""A passkey in software, for the tests.

A P-256 key pair that answers WebAuthn ceremonies the way a browser and an authenticator
together would — `credential.toJSON()`'s shape, `none` attestation, a signature over the
authenticator data and the client data's hash — with no browser and no device.
"""

from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import dataclass, field
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, encode_cbor

from blob_api.services.passkeys import relying_party

#: Authenticator data flags (WebAuthn §6.1).
USER_PRESENT = 0x01
USER_VERIFIED = 0x04
BACKUP_ELIGIBLE = 0x08
BACKED_UP = 0x10
ATTESTED = 0x40


def _b64(data: bytes) -> str:
    return bytes_to_base64url(data)


@dataclass
class SoftPasskey:
    key: ec.EllipticCurvePrivateKey = field(
        default_factory=lambda: ec.generate_private_key(ec.SECP256R1())
    )
    credential_id: bytes = field(default_factory=lambda: os.urandom(32))
    user_handle: bytes | None = None
    sign_count: int = 0
    #: A synced passkey — iCloud Keychain, Google Password Manager — rather than one
    #: bound to a single device.
    synced: bool = True

    def _cose_public_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return encode_cbor(
            {
                1: 2,  # kty: EC2
                3: -7,  # alg: ES256
                -1: 1,  # crv: P-256
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def _auth_data(self, *, attested: bool, verified: bool, rp_id: str | None = None) -> bytes:
        flags = USER_PRESENT | (USER_VERIFIED if verified else 0)
        if self.synced:
            flags |= BACKUP_ELIGIBLE | BACKED_UP
        if attested:
            flags |= ATTESTED
        data = (
            hashlib.sha256((rp_id or relying_party()[0]).encode()).digest()
            + bytes([flags])
            + struct.pack(">I", self.sign_count)
        )
        if attested:
            data += (
                b"\x00" * 16  # AAGUID: none, as `none` attestation reports it
                + struct.pack(">H", len(self.credential_id))
                + self.credential_id
                + self._cose_public_key()
            )
        return data

    def _client_data(self, kind: str, challenge: str, origin: str | None) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": challenge,
                "origin": origin or relying_party()[1],
                "crossOrigin": False,
            }
        ).encode()

    def create(
        self, options: dict[str, Any], *, origin: str | None = None, verified: bool = True
    ) -> dict[str, Any]:
        """Answer a registration's options as `credential.toJSON()` would."""
        self.user_handle = base64url_to_bytes(options["user"]["id"])
        client_data = self._client_data("webauthn.create", options["challenge"], origin)
        attestation = encode_cbor(
            {
                "fmt": "none",
                "attStmt": {},
                "authData": self._auth_data(attested=True, verified=verified),
            }
        )
        return {
            "id": _b64(self.credential_id),
            "rawId": _b64(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client_data),
                "attestationObject": _b64(attestation),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def get(
        self,
        options: dict[str, Any],
        *,
        origin: str | None = None,
        verified: bool = True,
        rp_id: str | None = None,
    ) -> dict[str, Any]:
        """Answer an authentication's options as `credential.toJSON()` would."""
        self.sign_count += 1
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = self._auth_data(attested=False, verified=verified, rp_id=rp_id)
        signature = self.key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        response: dict[str, Any] = {
            "clientDataJSON": _b64(client_data),
            "authenticatorData": _b64(auth_data),
            "signature": _b64(signature),
        }
        if self.user_handle is not None:
            response["userHandle"] = _b64(self.user_handle)
        return {
            "id": _b64(self.credential_id),
            "rawId": _b64(self.credential_id),
            "type": "public-key",
            "response": response,
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }
