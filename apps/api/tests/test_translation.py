from __future__ import annotations

import pytest

from blob_api.services import translation as translation_service

from .helpers import Client, send_message, sign_up


async def test_message_translation_uses_preferred_language_and_caches_result(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    message = await send_message(owner, general, "Bonjour tout le monde")
    assert message.status == 201

    updated = await owner.patch("/api/me/prefs", {"language": "en", "autoTranslate": True})
    assert updated.status == 200

    calls = 0

    async def fake_translate(
        text_value: str, *, target_language: str, source_language: str | None = None
    ) -> translation_service.TranslationPayload:
        nonlocal calls
        calls += 1
        assert text_value == "Bonjour tout le monde"
        assert target_language == "en"
        assert source_language is None
        return translation_service.TranslationPayload(
            provider="stub",
            source_language="fr",
            target_language="en",
            translated_text="Hello everyone",
        )

    monkeypatch.setattr(translation_service, "translate_text", fake_translate)

    first = await owner.post(f"/api/messages/{message.body['message']['id']}/translate", {})
    assert first.status == 200
    assert first.body["translation"]["translatedText"] == "Hello everyone"
    assert first.body["translation"]["cached"] is False

    second = await owner.post(f"/api/messages/{message.body['message']['id']}/translate", {})
    assert second.status == 200
    assert second.body["translation"]["translatedText"] == "Hello everyone"
    assert second.body["translation"]["cached"] is True
    assert calls == 1


async def test_message_translation_cache_is_invalidated_after_edit(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    message = await send_message(owner, general, "Bonjour")
    assert message.status == 201
    message_id = message.body["message"]["id"]

    prefs = await owner.patch("/api/me/prefs", {"language": "en"})
    assert prefs.status == 200

    calls: list[str] = []

    async def fake_translate(
        text_value: str, *, target_language: str, source_language: str | None = None
    ) -> translation_service.TranslationPayload:
        calls.append(text_value)
        return translation_service.TranslationPayload(
            provider="stub",
            source_language="fr",
            target_language=target_language,
            translated_text=f"translated:{text_value}",
        )

    monkeypatch.setattr(translation_service, "translate_text", fake_translate)

    first = await owner.post(f"/api/messages/{message_id}/translate", {})
    assert first.status == 200
    assert first.body["translation"]["translatedText"] == "translated:Bonjour"

    edited = await owner.patch(f"/api/messages/{message_id}", {"body": "Bonjour encore"})
    assert edited.status == 200

    second = await owner.post(f"/api/messages/{message_id}/translate", {})
    assert second.status == 200
    assert second.body["translation"]["translatedText"] == "translated:Bonjour encore"
    assert calls == ["Bonjour", "Bonjour encore"]


async def test_message_translation_requires_a_target_language(client: Client) -> None:
    owner = await sign_up(client, "Owner")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    message = await send_message(owner, general, "Hola")
    assert message.status == 201

    response = await owner.post(f"/api/messages/{message.body['message']['id']}/translate", {})
    assert response.status == 403
    assert (
        response.body["error"]["message"] == "Set your preferred language before using translation."
    )
