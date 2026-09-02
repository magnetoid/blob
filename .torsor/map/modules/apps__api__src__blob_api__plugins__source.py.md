---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T05:21:53'
updated: '2026-09-02T05:21:53'
---

# apps/api/src/blob_api/plugins/source.py

Symbols in `apps/api/src/blob_api/plugins/source.py`.

- L45 `RepoSource` (class) — A repository, resolved to the pieces a deploy needs.
- L60 `raw_manifest_url(repo_url: str, ref: str)` (function) — Where `blob-app.json` lives for a GitHub repository.
- L83 `read_manifest(repo_url: str, ref: str='main')` (function)
- L150 `_compose_path(document: dict[str, object], build_pack: str)` (function) — Which compose file to build, checked here so a bad one fails before the deploy.
