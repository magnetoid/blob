---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/themes.py

Symbols in `apps/api/src/blob_api/routers/themes.py`.

- L21 `ThemesOut` (class)
- L27 `ThemeOut` (class)
- L31 `SaveThemeInput` (class)
- L39 `slugify(name: str)` (function)
- L45 `list_themes(user: SessionUser=Depends(current_user))` (function)
- L55 `save_theme(payload: SaveThemeInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L82 `delete_theme(theme_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
