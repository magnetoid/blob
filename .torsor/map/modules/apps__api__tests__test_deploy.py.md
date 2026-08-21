---
type: map
status: derived
tags:
- map
links: []
created: '2026-08-21T03:48:04'
updated: '2026-08-21T03:48:04'
---

# apps/api/tests/test_deploy.py

Symbols in `apps/api/tests/test_deploy.py`.

- L23 `build_dist(root: Path)` (function) — The shape `vite build` leaves behind.
- L34 `web(tmp_path: Path)` (function) — A miniature app: one API route, and the client mounted the way main.py mounts it.
- L48 `test_the_root_serves_the_app(web: httpx.AsyncClient)` (function)
- L54 `test_a_deep_link_serves_the_app(web: httpx.AsyncClient)` (function)
- L61 `test_real_files_are_served_as_themselves(web: httpx.AsyncClient)` (function)
- L66 `test_routes_still_win_over_the_mount(web: httpx.AsyncClient)` (function)
- L70 `test_an_unknown_api_path_is_a_404_not_the_app(web: httpx.AsyncClient)` (function)
- L79 `test_fingerprinted_assets_are_cached_and_the_document_is_not(web: httpx.AsyncClient)` (function)
- L88 `test_an_unbuilt_client_is_not_fatal(tmp_path: Path)` (function)
- L94 `test_liveness_needs_no_session_and_touches_nothing(client: Client)` (function)
- L100 `test_liveness_does_not_publish_socket_counts(client: Client)` (function)
- L105 `test_readiness_checks_the_datastores(client: Client)` (function)
- L112 `test_health_is_reachable_without_signing_in(client: Client, path: str)` (function)
