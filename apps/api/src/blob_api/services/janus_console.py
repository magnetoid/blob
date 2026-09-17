"""What Janus *is*, for the console: read it, change it, restart it.

`services/janus_agent.py` puts Janus into every workspace and signs the runs that reach
it. This is the other half: the model it answers as, the provider and key behind it, how
long it may think, which toolsets it may use. None of that is Blob's data — it is
`config.yaml` and `.env` on Janus's own volume — so nothing here writes a file or touches
Docker. Janus 0.17.0 exposes `GET`/`PUT /v1/config` beside `/health`, `/v1/capabilities`,
`/v1/skills` and `/v1/toolsets`, and this module is a client of them.

Three rules it exists to keep.

**A provider key's value appears in no Blob response, no log line and no audit row,
ever.** A key typed into the page passes through this process to Janus and is gone: it is
not stored, not echoed, and the audit event names the *key* and never its value. That
holds on four paths, because a key reaches this module by four routes:

* Janus's mask (`providers[].key` is `{set, tail}`) is narrowed again by `_masked_key`
  rather than relayed — "the other side promised" is not a defence for a secret.
* A key written by hand into `config.yaml` — a `custom_providers` entry carries its own
  `api_key` — comes back inside `raw`, which Janus returns verbatim. `redact_secrets`
  takes it out on the way to the page, and `update` refuses a `raw` that comes back still
  carrying the placeholder. What it must *not* take out is the keyless config Janus
  documents — `api_key: ${GOOGLE_API_KEY}` is a reference, not a secret, and redacting it
  would make the file unsaveable; `_is_credential` is where that line is drawn.
* Anything built out of Janus's *answer* — a refusal's message, its issues, and the
  success body too — goes through `_scrub`/`_scrub_tree` against every credential the
  request is carrying, because a YAML parse error quotes the line it choked on.
* The audit row names fields and key names, never a value.

**The address is composed, never taken from a caller.** `api_base()` is the origin of
`JANUS_AGUI_URL`, which is Blob's own setting, so `_assert_reachable` — the SSRF guard on
the plugin *registration* routes — does not apply for the same structural reason it does
not apply in `janus_agent`: a request cannot choose where `JANUS_API_SERVER_KEY` is sent.

**One tile down is not the page down.** `overview()` asks the five routes at once and
keeps each answer beside its own error, so a `/v1/skills` that fails costs the skills
list and nothing else. That is "fail toward the workspace staying up" at the width of one
page.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.errors import AppError, bad_request
from . import agent_runs as agent_run_service
from . import audit as audit_service
from . import janus_agent, seeded
from .audit import Actor

log = logging.getLogger("blob.janus_console")

#: Janus's `GET /v1/config` makes a live provider call with a ten-second budget of its
#: own, so a shorter deadline here would report an unreachable Janus that is merely busy
#: asking DeepSeek what models it serves.
TIMEOUT_SEC = 12.0

#: The five routes the page is composed from, in the order the overview carries them.
#: `/health` is unauthenticated on Janus's side and asked with the bearer anyway — one
#: header for all five is one thing to get wrong instead of two.
ROUTES: tuple[tuple[str, str], ...] = (
    ("health", "/health"),
    ("capabilities", "/v1/capabilities"),
    ("config", "/v1/config"),
    ("skills", "/v1/skills"),
    ("toolsets", "/v1/toolsets"),
)

#: Everything a page may learn about a key. Janus sends exactly this; anything else in the
#: object is dropped rather than relayed.
KEY_FIELDS = ("set", "tail")

#: What stands in for a credential written into `config.yaml` by hand. A word rather than
#: a run of asterisks so that a save of the text the page showed is *recognisable* on the
#: way back in — see `update`, which refuses it.
REDACTED = "«redacted»"

#: A YAML line whose value could be a credential: a key named `api_key`, `token`, `secret`
#: or `password`, or ending in one of them (`openai_api_key`, `bot_token`). `head` is
#: everything up to the value; `value` is the value *with* its quotes, if it had any.
#:
#: `api[-_]?key` rather than `api_key`, because a `custom_providers` block is copied out of
#: whatever the provider's own documentation shows: `api-key` is Azure OpenAI's header and
#: `apiKey` is what most JavaScript SDKs call it, and the pattern is case-insensitive
#: anyway. A spelling this misses is a live key rendered onto a web page.
#:
#: Line-based, not a parse. A parse would be exact and would also be useless here, because
#: this has to work on text that *does not parse* — the one place a pasted key most needs
#: taking out of a message is the YAML error quoting the line it choked on.
#:
#: Three things the pattern deliberately handles, each a way a key really is written:
#:
#: * a leading `#` — a commented-out `# api_key: sk-…` is how an operator keeps the old
#:   key while trying a new one, and on a web page it is as much a credential as the live
#:   line above it;
#: * a block-sequence dash (`- api_key: sk-…`);
#: * a `#` *inside* the value. YAML starts a comment at `#` only after whitespace, so
#:   `sk-ab#cd` is one scalar — stopping at the `#` used to leave `#cd`, the tail of a
#:   key, on the page.
#:
#: And these among others it does not — the list is what has been thought about, not a
#: proof of completeness. Each needs a parser, and none is written by Janus's own docs or
#: by `janus config set`: a flow map (`{api_key: sk-…}`); a block scalar (`api_key: >`
#: with the value indented beneath); a quoted key name (`"api_key": sk-…`), where the
#: quote sits between the key and the `:` this rule looks for; a quoted scalar carried
#: over more than one line, of which only the first is redacted; and a plain scalar on the
#: line *after* its key. That last one was matched once, by letting the pattern cross a
#: newline, and the cure was worse than the disease: `api_key:` with nothing after it then
#: redacted whatever stood on the next line. A line rule stops at the newline.
_SECRET_LINE = re.compile(
    r"^(?P<head>[^\S\n]*(?:#[^\S\n]*)?(?:-[^\S\n]+)*[\w.\-]*"
    r"(?:api[-_]?key|token|secret|password)[^\S\n]*:[^\S\n]*)"
    r"(?P<value>\"[^\"\n]*\"|'[^'\n]*'|[^\s#][^\n]*?)"
    r"(?=[^\S\n]+#|[^\S\n]*$)",
    re.IGNORECASE | re.MULTILINE,
)

#: `${VAR}` — Janus expands these out of the environment when it loads the file, and its
#: documentation recommends them as the way to keep a key *out* of `config.yaml`
#: (`website/docs/user-guide/configuration.md`). Only this form: the same page says a bare
#: `$VAR` is not expanded, which makes `$VAR` a literal string and therefore a credential
#: like any other.
_ENV_REF = re.compile(r"\$\{[^}]+\}")

#: YAML's ways of writing nothing. Compared lower-cased.
_YAML_NULLS = frozenset({"null", "~"})

#: A credential is not four characters. Below this a matched value is redacted from the
#: file all the same — that costs nothing — but it is *not* used as a scrub needle: a
#: `# token: TODO`, or the `OLLAMA_API_KEY=none` a local model wants, would otherwise turn
#: every "TODO" and every "none" in Janus's own words into `***`, mangling the sentence an
#: operator has to read in order to protect nothing.
MIN_SCRUBBABLE = 8


@dataclass(slots=True)
class Part:
    """One of Janus's routes: its answer, or why there isn't one. Never both."""

    data: Any | None = None
    error: str | None = None


@dataclass(slots=True)
class Install:
    """A workspace holding the seeded agent, as the console's table shows it."""

    workspace_id: str
    workspace_name: str
    plugin_id: str
    status: str
    channel_count: int
    runs_last_week: int
    #: Which row is the caller's own, so the page can link it to `/admin/apps/{id}`.
    #: An instance admin sees every workspace here, most of which are not theirs to open.
    is_this_workspace: bool


@dataclass(slots=True)
class Overview:
    """Everything the page reads in one request: Janus's five routes and Blob's facts."""

    health: Part
    capabilities: Part
    config: Part
    skills: Part
    toolsets: Part
    agui_url: str | None
    secret_set: bool
    installs: list[Install]


@dataclass(slots=True)
class ConfigChange:
    """A change on its way to Janus. Every field optional; at least one required.

    `None` means "leave it alone", which is why the body is built from what is set rather
    than dumped whole: a `PUT` carrying `model: null` would read as a change to Janus and
    a caller who only wanted to move the reasoning effort would clear the model.
    """

    model: dict[str, Any] | None = None
    agent: dict[str, Any] | None = None
    toolsets: list[str] | None = None
    api_keys: dict[str, str] | None = None
    raw: str | None = None
    restart: bool | None = None


@dataclass(slots=True)
class Applied:
    """Janus's answer to a `PUT`: what landed, what it warns about, whether it is going."""

    applied: dict[str, Any]
    warnings: list[dict[str, Any]]
    restarting: bool
    drain_timeout_seconds: float


def configured() -> bool:
    """The agent is installed *and* its API has a bearer.

    Both halves of `janus_agent.configured()` plus the key: the signing secret gets a
    mention answered, and this key is what reads and changes the thing answering. With the
    agent running and no key the page says which line is missing — see the router — rather
    than claiming nothing is there.
    """
    return janus_agent.configured() and bool(settings.JANUS_API_SERVER_KEY)


def api_base() -> str:
    """`http://janus:8642` — the origin of the AG-UI address, with the path dropped.

    Derived rather than a second setting: it is the same server by construction, and a
    second URL is a second thing to get wrong on an operator's `.env`.
    """
    parts = urlsplit(settings.JANUS_AGUI_URL or "")
    return f"{parts.scheme}://{parts.netloc}"


def open_client() -> httpx.AsyncClient:
    """The HTTP client this module talks to Janus with.

    A named seam, patched by the tests, for the reason `lib/llm.open_client` records:
    substituting `httpx.AsyncClient` itself reaches the module object the test suite's own
    ASGI client is built from, and the fake meant for Janus ends up answering the requests
    to the app under test.
    """
    return httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_SEC))


def _bearer() -> dict[str, str]:
    return {"authorization": f"Bearer {settings.JANUS_API_SERVER_KEY or ''}"}


def _require_configured() -> None:
    if not configured():
        raise bad_request("Janus is not running in this stack.", code="janus_not_configured")


def _without_secrets(message: str, *secrets: str | None) -> str:
    """The same text with every credential we are holding replaced.

    Three kinds pass through here: `JANUS_API_SERVER_KEY`, which could reach a message
    through a transport error naming the request; the `apiKeys` values of the change being
    made, which could reach one through an answer that echoed them back; and anything
    written inline in a submitted `raw`, which a YAML parse error quotes by quoting the
    line. None may be relayed, so all are replaced before anything built out of an outside
    string is returned or logged.
    """
    for secret in secrets:
        if secret and secret in message:
            message = message.replace(secret, "***")
    return message


def _scrub(message: str, *secrets: str | None) -> str:
    """One line, with anything we are holding taken out of it.

    The collapsing is for `error.message`, which a page shows as a sentence: a YAML parse
    error is four lines of position information and a UI renders that as a run-on.
    Structured data keeps its shape — see `_scrub_tree`.
    """
    return _without_secrets(" ".join(message.split()), *secrets)


def _unquoted(value: str) -> tuple[str, str]:
    """A captured value split into its quote character, if any, and its text."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[0], value[1:-1]
    return "", value


def _is_credential(value: str) -> bool:
    """Whether a secret-shaped key's value is actually a secret.

    Three things wear the shape and are not one, and treating them as secrets is not a
    harmless excess of caution — it is a bug with teeth:

    * **An environment reference.** `api_key: ${GOOGLE_API_KEY}` is Janus's *recommended*
      keyless config. Redacting it showed a placeholder for something that was never
      secret and, worse, made the Advanced tab unsaveable: the page's own text came back
      carrying `REDACTED` and `update` refused it with advice — put the key back — that is
      wrong in exactly this case, because there is no key to put back. A value made
      entirely of `${VAR}` references and separators is a reference; one with a literal
      beside it (`${PREFIX}sk-…`) is not, because the literal half is where a key hides.
    * **Nothing at all** — an empty value, or a quoted empty one.
    * **YAML's ways of writing nothing** — `null`, `~`.
    """
    text_ = value.strip()
    if not text_ or text_.lower() in _YAML_NULLS or text_ == REDACTED:
        return False
    return bool(re.search(r"\w", _ENV_REF.sub("", text_)))


def _needles(values: Iterable[str]) -> tuple[str, ...]:
    """The values worth replacing as a substring. See `MIN_SCRUBBABLE`."""
    return tuple(value for value in values if len(value) >= MIN_SCRUBBABLE)


def secret_values_in(raw: str | None) -> tuple[str, ...]:
    """Every credential written inline in a `config.yaml` text.

    Keys belong in `.env` and that is where Janus's own `config set` puts them — but a
    `custom_providers` entry carries its own `api_key`, and an operator editing the file by
    hand can put one anywhere. So the text Blob is handling may hold a secret Blob was
    never given as a key, and neither `apiKeys` nor `JANUS_API_SERVER_KEY` knows about it.

    These become scrub needles, so what is not a credential (`_is_credential`) and what is
    too short to replace safely (`MIN_SCRUBBABLE`) are both left out.
    """
    if not raw:
        return ()
    found = set()
    for match in _SECRET_LINE.finditer(raw):
        _quote, value = _unquoted(match.group("value"))
        if _is_credential(value):
            found.add(value)
    return _needles(sorted(found))


def redact_secrets(raw: str) -> str:
    """`config.yaml`'s text with every inline credential replaced by `REDACTED`.

    **Blob does this, not Janus, on purpose.** Janus 0.17.0 returns the file exactly as
    written, which is right for the thing that owns it: `janus config set` and an operator
    with a shell both need the real text. Blob is the only reader that puts that file on a
    web page, so Blob is where a key stops — the same reasoning that narrows
    `providers[].key` to `{set, tail}` rather than trusting the sender's mask.

    Only a value that really is a secret goes, and only the value: the key name, the
    indentation, the quotes, the comments and the line order all survive, so what the
    Advanced tab shows still reads and parses as YAML, a diff against the file is one line
    per key, and a file whose keys live in the environment round-trips byte for byte.
    `_SECRET_LINE` records what a line rule cannot see.
    """

    def redact(match: re.Match[str]) -> str:
        quote, value = _unquoted(match.group("value"))
        if not _is_credential(value):
            return match.group(0)
        return f"{match.group('head')}{quote}{REDACTED}{quote}"

    return _SECRET_LINE.sub(redact, raw)


def _masked_key(key: Any) -> Any:
    """`providers[].key`, narrowed to presence and the tail.

    Janus already sends only this. Narrowing it again is the belt-and-braces on the mask:
    the one field in the whole config that is *about* a secret is the one field where a
    relay must not pass through what it does not recognise. `tail` is absent, not null,
    for a key of four characters or fewer — the last four characters of a four-character
    secret are the secret — so the key is copied only when Janus sent it.
    """
    if not isinstance(key, dict):
        return key
    return {name: key[name] for name in KEY_FIELDS if name in key}


def _masked_config(data: Any) -> Any:
    """`GET /v1/config` on its way to the page: keys narrowed, the file redacted.

    The two places a credential can be in that body, and both are closed here rather than
    at the router, so there is one answer to "where does Blob stop showing a key".
    """
    if not isinstance(data, dict):
        return data
    masked = dict(data)
    providers = masked.get("providers")
    if isinstance(providers, list):
        masked["providers"] = [
            {**entry, "key": _masked_key(entry.get("key"))} if isinstance(entry, dict) else entry
            for entry in providers
        ]
    raw = masked.get("raw")
    if isinstance(raw, str):
        masked["raw"] = redact_secrets(raw)
    return masked


def _scrub_tree(value: Any, *secrets: str | None) -> Any:
    """Every string anywhere in an answer, scrubbed. Structure untouched.

    Janus's 200 body was the one answer relayed whole — `applied` and `warnings` go
    straight into Blob's response — which made the rule "no key in any Blob response"
    depend on Janus keeping its half of it. It keeps it; this is what makes that
    unnecessary.
    """
    if isinstance(value, str):
        # `_without_secrets`, not `_scrub`: this walks structured data the page renders
        # field by field, and collapsing whitespace would be an edit nobody asked for.
        return _without_secrets(value, *secrets)
    if isinstance(value, dict):
        # Keys as well as values: `applied.api_keys` can arrive as a name-to-value map,
        # and `_masked_applied` publishes its *keys* as the names — so a key echoed as a
        # key would have gone out under the one narrowing meant to stop it.
        return {
            (_without_secrets(key, *secrets) if isinstance(key, str) else key): _scrub_tree(
                item, *secrets
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub_tree(item, *secrets) for item in value]
    return value


def _masked_applied(applied: dict[str, Any]) -> dict[str, Any]:
    """`applied` on its way back, with `api_keys` narrowed to names.

    Janus echoes names there and nothing else. A future release that answered with a
    name-to-value map instead would otherwise publish every key the save carried, so the
    shape is narrowed rather than trusted — the same rule as `providers[].key`.
    """
    keys = applied.get("api_keys")
    if keys is None:
        return applied
    if isinstance(keys, dict):
        names = sorted(str(name) for name in keys)
    elif isinstance(keys, list):
        names = [str(name) for name in keys if isinstance(name, str)]
    else:
        names = []
    return {**applied, "api_keys": names}


class _JanusRefusedError(Exception):
    """Janus answered a read with something other than 200.

    The body is dropped for every status but one: a tile's error is shown on a page, and
    relaying a string built by another server is how something that was never meant to be
    published gets published. The exception is 409 — a managed install, whose whole answer
    *is* the sentence an operator needs, and which "Janus answered 409." does not carry.
    """

    def __init__(self, status: int, message: str | None = None) -> None:
        super().__init__(f"janus answered {status}")
        self.status = status
        self.message = message


def _error_text(payload: Any) -> str | None:
    """The `error` string out of a Janus refusal, if it said anything at all."""
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    return error if isinstance(error, str) and error.strip() else None


def _refusal_message(payload: Any) -> tuple[str, list[dict[str, Any]]]:
    """Janus's own words for a refusal, and the issues behind them.

    A structure error comes back as `{"error": "invalid config", "issues": [...]}`, and
    the issue is the sentence worth showing — "invalid config" says nothing a person can
    act on. Everything else is one `error` string.
    """
    if not isinstance(payload, dict):
        return "Janus refused that change.", []
    issues = payload.get("issues")
    issues = (
        [issue for issue in issues if isinstance(issue, dict)] if isinstance(issues, list) else []
    )
    first = next((issue for issue in issues if issue.get("message")), None)
    if first is not None:
        return str(first["message"]), issues
    return (_error_text(payload) or "Janus refused that change."), issues


def _unreachable(reason: str) -> AppError:
    """The one sentence for "Janus is not answering", whatever the cause underneath.

    A 401 and a refused connection are different operator facts and the same fact for the
    page — there is nothing an admin does differently — so the distinction goes to the log
    and the answer stays one sentence.
    """
    log.warning("janus api unreachable: %s", reason)
    return bad_request("Janus did not answer.", code="janus_unreachable")


async def _get_json(client: httpx.AsyncClient, path: str) -> Any:
    response = await client.get(f"{api_base()}{path}", headers=_bearer())
    if response.status_code != 200:
        message = _error_text(_body_of(response)) if response.status_code == 409 else None
        raise _JanusRefusedError(response.status_code, message)
    return response.json()


def _route_error(status: int, message: str | None) -> str:
    """What one tile says when its route answered but did not answer with the thing.

    Two statuses are named rather than left as a number to look up, because both are
    things an operator can act on. 401: `JANUS_API_SERVER_KEY` here and `API_SERVER_KEY`
    on the service are one value in the `.env` and drift the day somebody rotates one of
    them. 409: the config is managed by a package manager (NixOS, systemd), which the
    write path already answers in Janus's words — the read may as well agree. The key
    itself is never part of what is named.
    """
    if status == 401:
        log.warning("janus api rejected JANUS_API_SERVER_KEY on a console read (401)")
        return "Janus rejected JANUS_API_SERVER_KEY."
    if status == 409:
        if message:
            return _scrub(message, settings.JANUS_API_SERVER_KEY)
        return "Janus's configuration is managed elsewhere."
    return f"Janus answered {status}."


def _body_of(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {"error": response.text[:400]}


async def _parts() -> dict[str, Part]:
    """The five routes at once, each landing in its own tile.

    `return_exceptions=True` is what makes that true: one `await` per route in sequence
    would give a dead route the power to cost the page its other four, and `gather`
    without it would give it the power to cancel them.
    """
    async with open_client() as client:
        answers = await asyncio.gather(
            *(_get_json(client, path) for _name, path in ROUTES), return_exceptions=True
        )

    parts: dict[str, Part] = {}
    for (name, _path), answer in zip(ROUTES, answers, strict=True):
        if isinstance(answer, _JanusRefusedError):
            parts[name] = Part(error=_route_error(answer.status, answer.message))
        elif isinstance(answer, BaseException):
            parts[name] = Part(
                error=_scrub(f"{type(answer).__name__}: {answer}", settings.JANUS_API_SERVER_KEY)
            )
        else:
            parts[name] = Part(data=_masked_config(answer) if name == "config" else answer)
    return parts


async def _installs(session: AsyncSession, workspace_id: str) -> list[Install]:
    """Every workspace holding the agent this server seeds — and only that agent.

    The identity is `services/seeded.SEEDED_AGENT`, interpolated rather than re-spelt as
    three predicates of its own: this is the sixth reader of that constant, and a copy
    here would be a sixth place to forget a change. It is a module constant over literals
    the module owns, so it is SQL text and not a bound value.

    Its reasons are `janus_agent.existing_id`'s: the slug alone adopts rows that are
    somebody else's. A `runtime = 'container'` janus is a hosted agent the deployment sync
    owns, and a member's own socket agent named "Janus" gets this slug too because
    `routers/my_agents.py` derives one from the name. Neither is the thing this page
    configures.

    Columns by name rather than `p.*`: this table gains columns, and a `SELECT *` that
    feeds a dataclass turns the next migration into a surprise here.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT p.id AS plugin_id,
                       p.status AS status,
                       w.id AS workspace_id,
                       w.name AS workspace_name,
                       COALESCE(counted.channels, 0) AS channel_count
                  FROM plugins p
                  JOIN workspaces w ON w.id = p.workspace_id
                  LEFT JOIN LATERAL (
                      SELECT count(*) AS channels
                        FROM channel_members cm
                        JOIN users u ON u.id = cm.user_id
                        JOIN channels c ON c.id = cm.channel_id
                       WHERE u.bot_plugin_id = p.id
                         AND c.kind = 'public'
                         AND c.archived_at IS NULL
                  ) counted ON TRUE
                 WHERE {seeded.SEEDED_AGENT}
                 ORDER BY (w.id = :ws) DESC, w.name
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()

    plugin_ids = [str(row.plugin_id) for row in rows]
    # Reused rather than re-grouped: the console's agent table already answers "runs this
    # week, running now" for a page of plugins in one statement, and a plugin row belongs
    # to exactly one workspace, so a per-plugin count is a per-workspace count.
    activity = await agent_run_service.activity_by_plugin(session, plugin_ids)
    return [
        Install(
            workspace_id=str(row.workspace_id),
            workspace_name=row.workspace_name,
            plugin_id=str(row.plugin_id),
            status=row.status,
            channel_count=int(row.channel_count),
            runs_last_week=activity.get(str(row.plugin_id), (0, 0))[0],
            is_this_workspace=str(row.workspace_id) == workspace_id,
        )
        for row in rows
    ]


async def overview(session: AsyncSession, workspace_id: str) -> Overview:
    """The whole page in one request.

    `workspace_id` is the caller's, and marks their row in `installs` — an instance admin
    sees every workspace's install, most of which are not theirs to open.

    **Janus first, the database second.** `session_scope()` takes no connection out of the
    pool until the first statement runs, so doing the fan-out before `_installs` means the
    whole wait for Janus — up to ten seconds, because its `/v1/config` makes a live
    provider call — happens with this request holding nothing. The other order checks a
    connection out and autobegins a read transaction, then leaves both sitting idle for
    the duration; a handful of admins refreshing a page while a provider is slow would
    take the pool, and the workspace with it. The parts need no session at all, so the
    ordering is the whole fix. `tests/test_admin_janus` pins it by asking the pool how
    many connections were in use at the moment the fake Janus was called.
    """
    _require_configured()
    parts = await _parts()
    installs = await _installs(session, workspace_id)
    return Overview(
        health=parts["health"],
        capabilities=parts["capabilities"],
        config=parts["config"],
        skills=parts["skills"],
        toolsets=parts["toolsets"],
        agui_url=settings.JANUS_AGUI_URL,
        secret_set=bool(settings.JANUS_SIGNING_SECRET),
        installs=installs,
    )


def _janus_body(change: ConfigChange) -> dict[str, Any]:
    """The change as Janus's `PUT` takes it: snake_case, and only what was asked for.

    The camel/snake boundary is here rather than in the router because this is the edge —
    `apiKeys` is Blob's wire name and `api_keys` is Janus's, and one translation in one
    place is what keeps a field from being half-renamed.
    """
    body: dict[str, Any] = {}
    if change.model is not None:
        body["model"] = change.model
    if change.agent is not None:
        body["agent"] = change.agent
    if change.toolsets is not None:
        body["toolsets"] = change.toolsets
    if change.api_keys is not None:
        body["api_keys"] = change.api_keys
    if change.raw is not None:
        body["raw"] = change.raw
    if change.restart is not None:
        body["restart"] = change.restart
    return body


def _applied(payload: Any) -> Applied:
    """Janus's 200 body, read defensively.

    Every field is checked rather than trusted: this is somebody else's server answering
    over a network, and a shape the page cannot render is a blank screen with no reason on
    it. An older or newer Janus that omits a key gets the empty value for it.
    """
    data: dict[str, Any] = payload if isinstance(payload, dict) else {}
    applied = data.get("applied")
    warnings = data.get("warnings")
    # `bool` is an `int`, and `float(True)` is 1.0 — a truthy non-number must read as "no
    # timeout given", not as one second. Type-checked like its siblings rather than
    # coerced: `float("about three minutes")` raises, which turned a junk field in
    # somebody else's answer into a 500 here.
    drain = data.get("drain_timeout_seconds")
    return Applied(
        applied=_masked_applied(applied) if isinstance(applied, dict) else {},
        warnings=[entry for entry in warnings if isinstance(entry, dict)]
        if isinstance(warnings, list)
        else [],
        restarting=bool(data.get("restarting")),
        drain_timeout_seconds=float(drain)
        if isinstance(drain, (int, float)) and not isinstance(drain, bool)
        else 0.0,
    )


async def _put(body: dict[str, Any], *, secrets: tuple[str, ...]) -> Applied:
    """One `PUT /v1/config`, with Janus's vocabulary mapped onto Blob's.

    `secrets` are every credential this request is carrying — the values of `apiKeys`, and
    anything written inline in a submitted `raw`. They are scrubbed out of *everything*
    built from Janus's answer, the 200 included: Janus never echoes a value, but a proxy or
    a later release is not a promise worth betting a credential on, and the success body is
    relayed whole.
    """
    try:
        async with open_client() as client:
            response = await client.put(f"{api_base()}/v1/config", json=body, headers=_bearer())
    # Three shapes of "could not call it", and only the first is an httpx error. A
    # JANUS_AGUI_URL with no scheme leaves `api_base()` with nothing to build on, which
    # surfaces as httpx's own InvalidURL or, deeper in, as the ValueError urllib raises on
    # a request whose address names no protocol. All three are an operator's typo in an
    # env file, and a typo must read as "Janus did not answer" rather than as a 500.
    except (httpx.HTTPError, httpx.InvalidURL, ValueError) as error:
        raise _unreachable(
            _scrub(f"{type(error).__name__}: {error}", *secrets, settings.JANUS_API_SERVER_KEY)
        ) from error

    if response.status_code == 200:
        return _applied(_scrub_tree(_body_of(response), *secrets, settings.JANUS_API_SERVER_KEY))

    payload = _body_of(response)
    if response.status_code in (400, 409):
        # 400 is a change Janus will not write; 409 is a managed install whose config
        # belongs to its package manager. Both are the operator's to fix, and both say so
        # in Janus's own words — scrubbed, because a YAML parse error quotes the line it
        # choked on, and that line can be the one holding a key.
        message, issues = _refusal_message(payload)
        raise bad_request(
            _scrub(message, *secrets, settings.JANUS_API_SERVER_KEY),
            code="janus_refused",
            detail={"issues": _scrub_tree(issues, *secrets, settings.JANUS_API_SERVER_KEY)}
            if issues
            else None,
        )
    if response.status_code == 401:
        # The key, not the request. Named in the log so an operator can find it, and the
        # key itself is never part of what is named.
        raise _unreachable("Janus rejected JANUS_API_SERVER_KEY (401)")
    raise _unreachable(f"Janus answered {response.status_code}")


async def update(session: AsyncSession, actor: Actor, change: ConfigChange) -> Applied:
    """Forward a change to Janus, then record that it was made.

    Audited after Janus accepts, never before: a row reading "config changed" for a change
    Janus refused is worse than no row. The metadata names the *fields* and the *names* of
    any keys — never a value, which by then has left this process and is not written
    anywhere.
    """
    _require_configured()
    body = _janus_body(change)
    if not body or set(body) == {"restart"}:
        # Janus refuses these too. Answering here saves a round trip and, more to the
        # point, keeps `{"restart": false}` — which is a request to do nothing at all —
        # from reading as a save that worked. Blob's own code, not `janus_refused`: that
        # one means Janus saw this and said no, and a code that misnames who refused sends
        # the next person reading it to the wrong logs.
        raise bad_request("Nothing to change.", code="janus_empty_change")
    if change.raw is not None and REDACTED in change.raw:
        # The other half of `redact_secrets`. The page showed the file with its keys taken
        # out; saving that text back would write the placeholder into config.yaml *as* the
        # key, and the next run would fail authentication against a credential that is a
        # word. Refused here, so Janus never sees it and nothing is written.
        raise bad_request(
            "The file still holds a redacted key. Put the key back, or move it to the environment.",
            code="janus_raw_redacted",
        )

    key_names = sorted(change.api_keys or {})
    # Both kinds: the keys typed into the form, and any written by hand into the file.
    # Both under the same floor — `OLLAMA_API_KEY=none` is what a local model wants, and
    # a four-letter needle rewrites every "none" in Janus's own words. The value is still
    # forwarded exactly as typed; what counts as a usable key is Janus's to judge.
    secrets = (
        *_needles(value for value in (change.api_keys or {}).values() if value),
        *secret_values_in(change.raw),
    )
    applied = await _put(body, secrets=secrets)

    await audit_service.record(
        session,
        actor,
        "janus.config_changed",
        target_type="janus",
        metadata={
            "fields": _changed_fields(change),
            "apiKeys": key_names,
            "restarting": applied.restarting,
        },
    )
    return applied


def _changed_fields(change: ConfigChange) -> list[str]:
    """Which sections the change carried, under the names the page uses.

    `apiKeys`, not `api_keys`: the audit log is read on the page it was written from, so
    it says what the person clicking saw.
    """
    named = (
        ("model", change.model),
        ("agent", change.agent),
        ("toolsets", change.toolsets),
        ("apiKeys", change.api_keys),
        ("raw", change.raw),
    )
    return [name for name, value in named if value is not None]


async def restart(session: AsyncSession, actor: Actor) -> Applied:
    """Ask Janus to restart, writing nothing.

    `{"restart": true}` alone is a real request on Janus's side — "apply what is already on
    disk" — and answers `applied: {}`. It is the button beside a save that could not
    restart, and the way back from a config somebody changed on the volume by hand.
    """
    _require_configured()
    applied = await _put({"restart": True}, secrets=())
    await audit_service.record(
        session,
        actor,
        "janus.restarted",
        target_type="janus",
        metadata={"restarting": applied.restarting},
    )
    return applied


__all__ = [
    "REDACTED",
    "Applied",
    "ConfigChange",
    "Install",
    "Overview",
    "Part",
    "api_base",
    "configured",
    "open_client",
    "overview",
    "redact_secrets",
    "restart",
    "secret_values_in",
    "update",
]
