---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/services/themes.py

Symbols in `apps/api/src/blob_api/services/themes.py`.

- L92 `Theme` (class)
- L102 `validate_tokens(tokens: dict[str, Any])` (function) — Reject unknown keys and anything that is not plainly a colour.
- L377 `_row_to_theme(row: Any)` (function)
- L389 `ensure_presets(session: AsyncSession, workspace_id: str)` (function) — Insert the shipped presets once per workspace. Safe to call on every boot.
- L424 `list_themes(session: AsyncSession, workspace_id: str)` (function)
- L440 `save_theme(session: AsyncSession, workspace_id: str, created_by: str, *, theme_id: str | None, slug: str, name: str, mode: Mode, tokens: dict[str, Any], is_enabled: bool=True)` (function)
- L520 `delete_theme(session: AsyncSession, workspace_id: str, theme_id: str)` (function)
