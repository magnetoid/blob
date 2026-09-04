---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-04T17:42:51'
updated: '2026-09-04T17:42:51'
---

# apps/api/tests/test_deploy.py

Symbols in `apps/api/tests/test_deploy.py`.

- L23 `build_dist(root: Path)` (function) — The shape `vite build` leaves behind.
- L34 `web(tmp_path: Path)` (function) — A miniature app: one API route, and the client mounted the way main.py mounts it.
- L48 `test_the_root_serves_the_app(web: httpx.AsyncClient)` (function)
- L54 `test_a_deep_link_serves_the_app(web: httpx.AsyncClient)` (function)
- L61 `test_a_missing_file_is_a_404_and_not_the_app(web: httpx.AsyncClient)` (function) — A request that names a file must not be answered with index.html.
- L76 `test_a_file_that_is_there_is_still_served(web: httpx.AsyncClient)` (function)
- L83 `test_real_files_are_served_as_themselves(web: httpx.AsyncClient)` (function)
- L88 `test_routes_still_win_over_the_mount(web: httpx.AsyncClient)` (function)
- L92 `test_an_unknown_api_path_is_a_404_not_the_app(web: httpx.AsyncClient)` (function)
- L101 `test_fingerprinted_assets_are_cached_and_the_document_is_not(web: httpx.AsyncClient)` (function)
- L110 `test_an_unbuilt_client_is_not_fatal(tmp_path: Path)` (function)
- L116 `test_liveness_needs_no_session_and_touches_nothing(client: Client)` (function)
- L122 `test_liveness_does_not_publish_socket_counts(client: Client)` (function)
- L127 `test_readiness_checks_the_datastores(client: Client)` (function)
- L134 `test_health_is_reachable_without_signing_in(client: Client, path: str)` (function)
