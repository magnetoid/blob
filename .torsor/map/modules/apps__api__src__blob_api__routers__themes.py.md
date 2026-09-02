---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
---

# apps/api/src/blob_api/routers/themes.py

Symbols in `apps/api/src/blob_api/routers/themes.py`.

- L21 `ThemesOut` (class)
- L27 `ThemeOut` (class)
- L31 `SaveThemeInput` (class)
- L39 `OkOut` (class)
- L43 `slugify(name: str)` (function)
- L49 `list_themes(user: SessionUser=Depends(current_user))` (function)
- L59 `save_theme(payload: SaveThemeInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L86 `delete_theme(theme_id: IdParam, request: Request, admin: SessionUser=Depends(require_admin))` (function)
