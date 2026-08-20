"""Message translation with provider-backed caching.

The translate endpoint is deliberately out of the hot message path: messages still store
their original text once, and translations are generated on demand per target language.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.errors import AppError, bad_request
from ..lib.ids import new_id
from ..schemas.models import MessageTranslation
from .serialize import to_message_translation

LANG_RE = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$")


@dataclass(slots=True)
class TranslationPayload:
    provider: str
    source_language: str | None
    target_language: str
    translated_text: str


def normalize_language_code(value: str) -> str:
    cleaned = value.strip()
    if not cleaned or not LANG_RE.match(cleaned):
        raise bad_request("Choose a valid language code.", code="invalid_language")
    parts = cleaned.split("-")
    normalized = [parts[0].lower()]
    for part in parts[1:]:
        normalized.append(part.upper() if len(part) <= 3 else part.title())
    return "-".join(normalized)


async def get_cached_translation(
    session: AsyncSession,
    *,
    message_id: str,
    target_language: str,
    source_body: str,
) -> MessageTranslation | None:
    row = (
        await session.execute(
            text(
                """
                SELECT *
                  FROM message_translations
                 WHERE message_id = :message_id
                   AND target_language = :target_language
                   AND source_body = :source_body
                """
            ),
            {
                "message_id": message_id,
                "target_language": target_language,
                "source_body": source_body,
            },
        )
    ).fetchone()
    return to_message_translation(row, cached=True) if row else None


async def store_translation(
    session: AsyncSession,
    *,
    workspace_id: str,
    message_id: str,
    requested_by: str | None,
    source_body: str,
    payload: TranslationPayload,
) -> MessageTranslation:
    row = (
        await session.execute(
            text(
                """
                INSERT INTO message_translations
                  (id, workspace_id, message_id, requested_by, provider, source_body,
                   source_language, target_language, translated_text)
                VALUES
                  (:id, :workspace_id, :message_id, cast(:requested_by AS uuid), :provider,
                   :source_body, :source_language, :target_language, :translated_text)
                ON CONFLICT (message_id, target_language) DO UPDATE
                  SET requested_by = EXCLUDED.requested_by,
                      provider = EXCLUDED.provider,
                      source_body = EXCLUDED.source_body,
                      source_language = EXCLUDED.source_language,
                      translated_text = EXCLUDED.translated_text,
                      updated_at = now()
                RETURNING *
                """
            ),
            {
                "id": new_id(),
                "workspace_id": workspace_id,
                "message_id": message_id,
                "requested_by": requested_by,
                "provider": payload.provider,
                "source_body": source_body,
                "source_language": payload.source_language,
                "target_language": payload.target_language,
                "translated_text": payload.translated_text,
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not store that translation.", code="translation_failed")
    return to_message_translation(row)


async def translate_text(
    text_value: str, *, target_language: str, source_language: str | None = None
) -> TranslationPayload:
    if not text_value.strip():
        raise bad_request("That message has no text to translate.", code="translation_empty")
    provider = settings.TRANSLATION_PROVIDER
    if provider == "disabled":
        raise AppError(
            503,
            "translation_unavailable",
            "Translation is not configured for this workspace yet.",
        )
    if provider == "libretranslate":
        return await _translate_libretranslate(
            text_value,
            target_language=target_language,
            source_language=source_language,
        )
    return await _translate_deepl(
        text_value,
        target_language=target_language,
        source_language=source_language,
    )


async def _translate_libretranslate(
    text_value: str, *, target_language: str, source_language: str | None
) -> TranslationPayload:
    base_url = (settings.TRANSLATION_BASE_URL or "https://libretranslate.com").rstrip("/")
    body: dict[str, str] = {
        "q": text_value,
        "source": _libre_code(source_language) if source_language else "auto",
        "target": _libre_code(target_language),
        "format": "text",
    }
    if settings.TRANSLATION_API_KEY:
        body["api_key"] = settings.TRANSLATION_API_KEY

    try:
        async with httpx.AsyncClient(timeout=settings.TRANSLATION_TIMEOUT_SEC) as client:
            response = await client.post(
                f"{base_url}/translate",
                json=body,
                headers={"content-type": "application/json"},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _translation_error(exc.response.text) from exc
    except httpx.HTTPError as exc:
        raise AppError(
            503,
            "translation_unavailable",
            "The translation provider did not respond.",
        ) from exc

    payload = response.json()
    translated_text = str(payload.get("translatedText") or "").strip()
    if not translated_text:
        raise AppError(503, "translation_unavailable", "The translation provider returned no text.")
    detected = payload.get("detectedLanguage") or {}
    detected_language = detected.get("language")
    return TranslationPayload(
        provider="libretranslate",
        source_language=normalize_language_code(detected_language)
        if isinstance(detected_language, str)
        else (normalize_language_code(source_language) if source_language else None),
        target_language=normalize_language_code(target_language),
        translated_text=translated_text,
    )


async def _translate_deepl(
    text_value: str, *, target_language: str, source_language: str | None
) -> TranslationPayload:
    if not settings.TRANSLATION_API_KEY:
        raise AppError(
            503,
            "translation_unavailable",
            "A DeepL API key is required before translation can be used.",
        )
    base_url = (settings.TRANSLATION_BASE_URL or "https://api-free.deepl.com").rstrip("/")
    body: dict[str, object] = {
        "text": [text_value],
        "target_lang": _deepl_code(target_language),
    }
    if source_language:
        body["source_lang"] = _deepl_code(source_language)

    try:
        async with httpx.AsyncClient(timeout=settings.TRANSLATION_TIMEOUT_SEC) as client:
            response = await client.post(
                f"{base_url}/v2/translate",
                json=body,
                headers={
                    "content-type": "application/json",
                    "authorization": f"DeepL-Auth-Key {settings.TRANSLATION_API_KEY}",
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _translation_error(exc.response.text) from exc
    except httpx.HTTPError as exc:
        raise AppError(
            503,
            "translation_unavailable",
            "The translation provider did not respond.",
        ) from exc

    payload = response.json()
    translations = payload.get("translations") or []
    first = translations[0] if translations else {}
    translated_text = str(first.get("text") or "").strip()
    if not translated_text:
        raise AppError(503, "translation_unavailable", "The translation provider returned no text.")
    detected_language = first.get("detected_source_language")
    return TranslationPayload(
        provider="deepl",
        source_language=normalize_language_code(detected_language)
        if isinstance(detected_language, str)
        else (normalize_language_code(source_language) if source_language else None),
        target_language=normalize_language_code(target_language),
        translated_text=translated_text,
    )


def _translation_error(response_text: str) -> AppError:
    if "429" in response_text:
        return AppError(
            503, "translation_unavailable", "The translation provider is rate limited."
        )
    return AppError(
        503, "translation_unavailable", "The translation provider rejected that request."
    )


def _libre_code(value: str) -> str:
    return normalize_language_code(value).split("-")[0]


def _deepl_code(value: str) -> str:
    return normalize_language_code(value).upper()
