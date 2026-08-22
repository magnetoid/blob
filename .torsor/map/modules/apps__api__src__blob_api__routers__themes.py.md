---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-22T03:21:58'
updated: '2026-08-22T03:21:58'
---

# apps/api/src/blob_api/routers/themes.py

Symbols in `apps/api/src/blob_api/routers/themes.py`.

- L20 `ThemesOut` (class)
- L26 `ThemeOut` (class)
- L30 `SaveThemeInput` (class)
- L38 `OkOut` (class)
- L42 `slugify(name: str)` (function)
- L48 `list_themes(user: SessionUser=Depends(current_user))` (function)
- L58 `save_theme(payload: SaveThemeInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L85 `delete_theme(theme_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
