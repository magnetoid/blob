---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T07:12:06'
updated: '2026-08-21T07:12:06'
---

# apps/api/src/blob_api/routers/plugins.py

Symbols in `apps/api/src/blob_api/routers/plugins.py`.

- L40 `PluginOut` (class)
- L60 `PluginsOut` (class)
- L64 `CatalogOut` (class) — What an app may ask for. Drives the consent screen.
- L71 `InstalledOut` (class)
- L78 `RepoInput` (class)
- L83 `RepoPreviewOut` (class) — What the console shows before anyone approves anything.
- L97 `DeploymentOut` (class)
- L103 `DeliveryOut` (class)
- L114 `DeliveriesOut` (class)
- L118 `TokenOut` (class)
- L122 `SecretOut` (class)
- L126 `OkOut` (class)
- L130 `_to_plugin(session: Any, row: Any)` (function)
- L167 `catalog(_admin: SessionUser=Depends(require_admin))` (function)
- L172 `list_plugins(admin: SessionUser=Depends(require_admin))` (function)
- L184 `install_plugin(manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L231 `_assert_reachable(url: str | None)` (function) — Refuse a request URL the server should not be made to fetch.
- L247 `update_plugin(plugin_id: str, manifest: Manifest, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L275 `approve_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Accept the wider permissions an update asked for.
- L295 `set_enabled(plugin_id: str, payload: dict[str, bool], request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L325 `rotate_secret(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L341 `issue_token(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function) — Mint a fresh bot token. Existing ones keep working until revoked.
- L359 `revoke_tokens(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L384 `list_deliveries(plugin_id: str, limit: Annotated[int, Query(ge=1, le=200)]=50, admin: SessionUser=Depends(require_admin))` (function) — The delivery log — the first place to look when an app says it heard nothing.
- L425 `uninstall_plugin(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L444 `preview_repo(payload: RepoInput, admin: SessionUser=Depends(require_admin))` (function) — Read the manifest so the scopes can be approved before anything is installed.
- L463 `install_from_repo(payload: RepoInput, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L481 `deployment_status(plugin_id: str, admin: SessionUser=Depends(require_admin))` (function)
- L491 `redeploy(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
- L501 `stop_agent(plugin_id: str, request: Request, admin: SessionUser=Depends(require_admin))` (function)
