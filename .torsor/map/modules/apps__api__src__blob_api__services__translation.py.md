---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T21:05:54'
updated: '2026-08-21T21:05:54'
---

# apps/api/src/blob_api/services/translation.py

Symbols in `apps/api/src/blob_api/services/translation.py`.

- L26 `TranslationPayload` (class)
- L33 `normalize_language_code(value: str)` (function)
- L44 `get_cached_translation(session: AsyncSession, *, message_id: str, target_language: str, source_body: str)` (function)
- L72 `store_translation(session: AsyncSession, *, workspace_id: str, message_id: str, requested_by: str | None, source_body: str, payload: TranslationPayload)` (function)
- L119 `translate_text(text_value: str, *, target_language: str, source_language: str | None=None)` (function)
- L144 `_translate_libretranslate(text_value: str, *, target_language: str, source_language: str | None)` (function)
- L190 `_translate_deepl(text_value: str, *, target_language: str, source_language: str | None)` (function)
- L244 `_translation_error(response_text: str)` (function)
- L254 `_libre_code(value: str)` (function)
- L258 `_deepl_code(value: str)` (function)
