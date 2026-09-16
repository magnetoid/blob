---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/tests/test_deploy.py

Symbols in `apps/api/tests/test_deploy.py`.

- L24 `build_dist(root: Path)` (function) — The shape `vite build` leaves behind.
- L35 `web(tmp_path: Path)` (function) — A miniature app: one API route, and the client mounted the way main.py mounts it.
- L49 `test_the_root_serves_the_app(web: httpx.AsyncClient)` (function)
- L55 `test_a_deep_link_serves_the_app(web: httpx.AsyncClient)` (function)
- L62 `test_a_missing_file_is_a_404_and_not_the_app(web: httpx.AsyncClient)` (function) — A request that names a file must not be answered with index.html.
- L77 `test_a_file_that_is_there_is_still_served(web: httpx.AsyncClient)` (function)
- L84 `test_real_files_are_served_as_themselves(web: httpx.AsyncClient)` (function)
- L89 `test_routes_still_win_over_the_mount(web: httpx.AsyncClient)` (function)
- L93 `test_an_unknown_api_path_is_a_404_not_the_app(web: httpx.AsyncClient)` (function)
- L102 `test_fingerprinted_assets_are_cached_and_the_document_is_not(web: httpx.AsyncClient)` (function)
- L111 `test_an_unbuilt_client_is_not_fatal(tmp_path: Path)` (function)
- L117 `test_liveness_needs_no_session_and_touches_nothing(client: Client)` (function)
- L123 `test_liveness_does_not_publish_socket_counts(client: Client)` (function)
- L128 `test_readiness_checks_the_datastores(client: Client)` (function)
- L136 `test_readiness_names_the_commit_it_serves(client: Client, monkeypatch: pytest.MonkeyPatch)` (function) — What the deploy job reads back after asking Coolify for a deploy.
- L151 `test_health_is_reachable_without_signing_in(client: Client, path: str)` (function)
