---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L37 `PluginOut` (class)
- L57 `PluginsOut` (class)
- L61 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L68 `InstalledOut` (class)
- L75 `DeliveryOut` (class)
- L86 `DeliveriesOut` (class)
- L90 `TokenOut` (class)
- L94 `SecretOut` (class)
- L98 `OkOut` (class)
- L102 `_to_plugin(session: Any, row: Any)` (function)
- L139 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L144 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L156 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L197 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L213 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L241 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L261 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L291 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L307 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L325 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L350 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L391 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
