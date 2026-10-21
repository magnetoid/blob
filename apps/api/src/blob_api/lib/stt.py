"""Speech to text, for voice messages (M3 · B2).

The smallest client for one endpoint that every speech service now speaks — OpenAI's
`POST /v1/audio/transcriptions`, multipart: the file, the model, the answer as JSON with
`text`. OpenAI's own models answer it, and so do the self-hosted ones (Speaches over
faster-whisper, LocalAI, vLLM), which is the way to keep a team's voices on its own
network. Like `lib/llm.py`, deliberately not a framework: one call, one seam for the
tests, and an error vocabulary of its own.
"""

from __future__ import annotations

import httpx

from ..config import settings


class SttError(Exception):
    """The provider could not, or would not, transcribe."""


def configured() -> bool:
    return bool(settings.STT_BASE_URL)


def provider_label() -> str:
    """What `attachments.transcript_provider` records: which model wrote the words."""
    return f"stt:{settings.STT_MODEL}"


def open_client() -> httpx.AsyncClient:
    """The HTTP client this module talks to the provider with — the seam the tests replace
    (a name this module owns, for the reason `lib/llm.open_client` gives)."""
    return httpx.AsyncClient(timeout=httpx.Timeout(settings.STT_TIMEOUT_SEC))


def _endpoint() -> str:
    base = (settings.STT_BASE_URL or "").rstrip("/")
    # Operators write the base either way; OpenAI's own documentation shows it with /v1.
    if base.endswith("/v1"):
        return f"{base}/audio/transcriptions"
    return f"{base}/v1/audio/transcriptions"


async def transcribe(audio: bytes, *, filename: str, content_type: str) -> str:
    """The words in this recording. Raises `SttError` for anything that is not an answer."""
    if not configured():
        raise SttError("No speech-to-text provider is configured.")
    headers = {"accept": "application/json"}
    if settings.STT_API_KEY:
        headers["authorization"] = f"Bearer {settings.STT_API_KEY}"
    try:
        async with open_client() as http:
            response = await http.post(
                _endpoint(),
                headers=headers,
                data={"model": settings.STT_MODEL, "response_format": "json"},
                files={"file": (filename, audio, content_type)},
            )
    except httpx.HTTPError as error:
        raise SttError(f"The speech service could not be reached: {error}") from error
    if response.status_code != 200:
        raise SttError(f"The speech service answered {response.status_code}.")
    try:
        body = response.json()
    except ValueError as error:
        raise SttError("The speech service answered with something that is not JSON.") from error
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str):
        raise SttError("The speech service answered with no text.")
    return text.strip()


__all__ = ["SttError", "configured", "open_client", "provider_label", "transcribe"]
