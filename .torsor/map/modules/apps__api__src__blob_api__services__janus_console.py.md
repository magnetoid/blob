---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-17T02:23:41'
updated: '2026-09-17T02:23:41'
---

# apps/api/src/blob_api/services/janus_console.py

Symbols in `apps/api/src/blob_api/services/janus_console.py`.

- L140 `Part` (class) — One of Janus's routes: its answer, or why there isn't one. Never both.
- L148 `Install` (class) — A workspace holding the seeded agent, as the console's table shows it.
- L163 `Overview` (class) — Everything the page reads in one request: Janus's five routes and Blob's facts.
- L177 `ConfigChange` (class) — A change on its way to Janus. Every field optional; at least one required.
- L194 `Applied` (class) — Janus's answer to a `PUT`: what landed, what it warns about, whether it is going.
- L203 `configured()` (function) — The agent is installed *and* its API has a bearer.
- L214 `api_base()` (function) — `http://janus:8642` — the origin of the AG-UI address, with the path dropped.
- L224 `open_client()` (function) — The HTTP client this module talks to Janus with.
- L235 `_bearer()` (function)
- L239 `_require_configured()` (function)
- L244 `_without_secrets(message: str, *secrets: str | None)` (function) — The same text with every credential we are holding replaced.
- L260 `_scrub(message: str, *secrets: str | None)` (function) — One line, with anything we are holding taken out of it.
- L270 `_unquoted(value: str)` (function) — A captured value split into its quote character, if any, and its text.
- L277 `_is_credential(value: str)` (function) — Whether a secret-shaped key's value is actually a secret.
- L299 `_needles(values: Iterable[str])` (function) — The values worth replacing as a substring. See `MIN_SCRUBBABLE`.
- L304 `secret_values_in(raw: str | None)` (function) — Every credential written inline in a `config.yaml` text.
- L325 `redact_secrets(raw: str)` (function) — `config.yaml`'s text with every inline credential replaced by `REDACTED`.
- L350 `_masked_key(key: Any)` (function) — `providers[].key`, narrowed to presence and the tail.
- L364 `_masked_config(data: Any)` (function) — `GET /v1/config` on its way to the page: keys narrowed, the file redacted.
- L385 `_scrub_tree(value: Any, *secrets: str | None)` (function) — Every string anywhere in an answer, scrubbed. Structure untouched.
- L412 `_masked_applied(applied: dict[str, Any])` (function) — `applied` on its way back, with `api_keys` narrowed to names.
- L431 `_JanusRefusedError` (class) — Janus answered a read with something other than 200.
- L440 `__init__(self, status: int, message: str | None=None)` (method)
- L446 `_error_text(payload: Any)` (function) — The `error` string out of a Janus refusal, if it said anything at all.
- L454 `_refusal_message(payload: Any)` (function) — Janus's own words for a refusal, and the issues behind them.
- L473 `_unreachable(reason: str)` (function) — The one sentence for "Janus is not answering", whatever the cause underneath.
- L484 `_get_json(client: httpx.AsyncClient, path: str)` (function)
- L492 `_route_error(status: int, message: str | None)` (function) — What one tile says when its route answered but did not answer with the thing.
- L512 `_body_of(response: httpx.Response)` (function)
- L519 `_parts()` (function) — The five routes at once, each landing in its own tile.
- L544 `_installs(session: AsyncSession, workspace_id: str)` (function) — Every workspace holding the agent this server seeds — and only that agent.
- L609 `overview(session: AsyncSession, workspace_id: str)` (function) — The whole page in one request.
- L640 `_janus_body(change: ConfigChange)` (function) — The change as Janus's `PUT` takes it: snake_case, and only what was asked for.
- L663 `_applied(payload: Any)` (function) — Janus's 200 body, read defensively.
- L690 `_put(body: dict[str, Any], *, secrets: tuple[str, ...])` (function) — One `PUT /v1/config`, with Janus's vocabulary mapped onto Blob's.
- L736 `update(session: AsyncSession, actor: Actor, change: ConfigChange)` (function) — Forward a change to Janus, then record that it was made.
- L788 `_changed_fields(change: ConfigChange)` (function) — Which sections the change carried, under the names the page uses.
- L804 `restart(session: AsyncSession, actor: Actor)` (function) — Ask Janus to restart, writing nothing.
