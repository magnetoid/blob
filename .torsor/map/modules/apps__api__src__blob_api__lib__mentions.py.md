---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-25T01:55:20'
updated: '2026-08-25T01:55:20'
---

# apps/api/src/blob_api/lib/mentions.py

Symbols in `apps/api/src/blob_api/lib/mentions.py`.

- L25 `MentionResult` (class)
- L34 `strip_code(body: str)` (function) — Remove fenced blocks and inline code so their contents never mention anyone.
- L39 `_simple_lower(value: str)` (function) — Lowercase one character to one character, the way Postgres does.
- L52 `mention_lookup_phrases(body: str)` (function) — Display-name phrases worth resolving against the database, lowercased.
- L82 `parse_mentions(body: str, name_to_id: dict[str, str])` (function) — Extract mentions from raw markdown.
- L118 `matches_keywords(body: str, keywords: list[str])` (function) — Does this message body hit any of the user's keyword alerts?
