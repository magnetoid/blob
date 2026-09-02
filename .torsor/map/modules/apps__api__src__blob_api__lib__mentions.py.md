---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T02:51:23'
updated: '2026-09-02T02:51:23'
---

# apps/api/src/blob_api/lib/mentions.py

Symbols in `apps/api/src/blob_api/lib/mentions.py`.

- L34 `MentionResult` (class)
- L56 `strip_code(body: str)` (function) — Remove fenced blocks and inline code so their contents never mention anyone.
- L61 `_simple_lower(value: str)` (function) — Lowercase one character to one character, the way Postgres does.
- L74 `mention_lookup_phrases(body: str)` (function) — Display-name phrases worth resolving against the database, lowercased.
- L104 `parse_mentions(body: str, targets: dict[str, MentionTarget])` (function) — Extract mentions from raw markdown.
- L162 `matches_keywords(body: str, keywords: list[str])` (function) — Does this message body hit any of the user's keyword alerts?
