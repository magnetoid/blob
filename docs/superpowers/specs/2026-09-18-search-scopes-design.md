# Search scopes in ⌘K

**Status:** design, 2026-09-18. Restates section "0.4 · Search scopes in ⌘K, as `2e` draws
them — M" of the mid-Sep → mid-Dec plan, written 2026-09-14, with every anchor re-verified
against the code as it stands today. Effort **M**. One commit per task, four tasks.

## What exists today (verified 2026-09-18, not quoted from the section)

| Kind | Where it lives now | State |
|---|---|---|
| Messages | `apps/api/src/blob_api/services/search.py:229` (`async def search`), `apps/api/src/blob_api/routers/search.py:53-75` (`SearchOut` = `messages/total/parsed/sort/nextCursor`, keyset) | **Already in the palette** — `apps/web/src/features/palette/CommandPalette.tsx:78-101` |
| Channels | `GET /api/channels/browse` — `apps/api/src/blob_api/routers/channels.py:50-65`, `apps/api/src/blob_api/services/channels.py:64-123` (ILIKE over name, description, topic at `:105-107`; `c.kind = 'public'` at `:101`; `LIMIT 200`, no cursor) | Not in the palette |
| People | `apps/api/src/blob_api/services/users.py:293-338` (`list_users`) — no `q`, no predicate; the whole roster ships in bootstrap | Palette fuzzy-matches the store locally |
| Files | `apps/api/src/blob_api/services/files.py:22-99` (`listing()`), `apps/api/src/blob_api/routers/files.py:107-130` | **No filename predicate; `attachments.filename` has no index** |

`pg_trgm` has been installed since `apps/api/src/blob_api/db/migrations/versions/0032_search_trgm_prefix.py`,
so a trigram index needs no extension. The migration head is **0043**
(`0043_plugin_instructions.py`); the next number is **0044**.

## What I verified, and what I found different from the 0.4 section's text

The section is thirteen days old and was written before two things landed. Everything below
was read, not assumed.

1. **"Messages" is not a new kind.** The palette has searched messages since 2026-09-14
   (`CommandPalette.tsx:78-101`, tests in `CommandPalette.search.test.tsx`). The 180 ms
   debounce is at `:96`, the `live` out-of-order guard at `:84`/`:99`, the `q.length < 2`
   floor at `:80`, and the "See all N results" row at `:237-246`. This slice **adds two
   sections to a list that already has two**, and turns one flat list into headed sections.

2. **The client already holds the asker's full channel reach.**
   `services/channels.py:43-61` (`list_for_user`) returns *"Channels the user belongs to,
   plus public channels they could join"* — joined private channels and DMs **and every
   unarchived public channel** — and that is what bootstrap sends
   (`services/users.py:88` → `store.ts:441`). A public channel founded later reaches every
   client as a workspace-wide `channel.created` frame (`services/channels.py:606-614`). So
   `channels.browse(q, false)` returns, today, a strict subset of what the store already
   holds; the section's stated rationale ("`channels.browse(q)` for unjoined public") is
   satisfied locally. The decision to call browse is kept — see below — but its real value
   is a top-up, not the source.
   **Ruling 2026-09-18:** dropped. A request per keystroke that can only return a subset
   of what the client holds is a second code path for nothing; the store is the source.

3. **The anchors moved.** `models.py:488-503` (the section's mirror target) is now
   `db/models.py:477-491`; `services/users.py:290-308` is now `:293-338`;
   `services/files.py:22-97` is now `:22-99`. `routers/files.py:107-130` and
   `SearchView.tsx:22-26` (`FILTERS`) are exact as written. The migration the section calls
   **0039** is **0044**.

4. **Nothing but `search` is metered.** `apps/api/src/blob_api/lib/rate_limit.py:28-63`
   holds every bucket: `search` is `Limit(30, 60)` at `:34`, and the only `consume` in the
   two routers this touches is `upload` (`Limit(20, 60)`, `:33`) on `POST /api/uploads`
   (`routers/files.py:138`) and `POST /api/uploads/{id}/complete` (`:198`). There is **no
   `browse` bucket and no `attachments` bucket**: `GET /api/channels/browse` and
   `GET /api/attachments` spend nothing. The section asked for this to be verified; it is.

5. **The section's rate-limit rule, read literally, contradicts its own done-when.**
   "channels and files fire only for `scope = all`" would leave `Tab`-narrowed-to-Files
   showing nothing, while the done-when is "`Tab` narrows to Files, and a filename match
   opens the message it is attached to". The rule is resolved to
   `scope === 'all' || scope === <that section's own scope>`, which is the reading that
   preserves the sentence's purpose — **`all` stays the only state with three requests in
   flight; a narrowed scope fires exactly one.**

6. **`help.ts` is already wrong.** `apps/web/src/lib/help.ts:96` still says the jump box
   "matches names, never the words inside messages — searching what people said is the
   other screen." That has been false since 2026-09-14. It is corrected here.

7. **`pathForRoute` cannot use `URLSearchParams`.** `router.test.ts:196-200` asserts
   `/search?q=from%3A%40ana%20deploy` exactly, and `URLSearchParams` writes a space as `+`.
   The scope is appended to the existing hand-built string.

## The shape of it

### Server — files only

`services/files.listing()` gains a keyword-only `q: str | None`:

```
AND (
     CAST(:q AS text) IS NULL
     OR a.filename ILIKE '%' || CAST(:q AS text) || '%'
)
```

placed beside the existing `kind` and `cursor` predicates, in the same `CAST(... AS ...) IS
NULL OR` idiom the `channel_id` branch already uses (`services/files.py:66-68`). The pattern
is **not** escaped for `%`/`_`, exactly as `services/channels.py:105-107` does not escape the
channel browse — one rule for both, and a `%` typed into either is a wildcard.

Migration **0044** adds `attachments_filename_trgm` as
`gin (filename gin_trgm_ops)`, mirrored in `db/models.py`'s `Attachment.__table_args__`
(`:479-491`) with `postgresql_ops={"filename": "gin_trgm_ops"}` so `alembic check` stays
quiet — Alembic compares an index by name, columns and uniqueness, all of which a plain
column index reflects cleanly, where an expression index is the shape that needs care.
`pg_trgm` folds case itself, which is why `ILIKE` uses this index unchanged and no
`lower()` wrapper is needed.

Filenames are **not** accent-folded. Message bodies are (`blob_unaccent`, migration 0030),
but that fold is a generated column with its own index and its expression cannot be altered
without a table rewrite; a filename has neither. `sta` will not find `šta.pdf`. Recorded,
not fixed.

`routers/files.py` takes `q: str | None = Query(None, max_length=100)`, strips it to `None`
when blank, and passes it through. No `text(` enters the router.

### Client — the palette

One flat option list stays one flat option list, with a presentational header emitted
whenever the section changes, so `aria-activedescendant` indices stay contiguous and the
combobox pattern `CommandPalette.a11y.test.tsx` pins is untouched. Order, which is also the
order `Tab` walks:

* **Channels** — the local store alone (joined private, DMs, every unarchived public
  channel), which is exactly the asker's reach. Ruled 2026-09-18: no `browse` call — see
  finding 2. "See all N channels" carries an exact N.
* **People** — local, as now. No endpoint exists and none is added.
* **Messages** — unchanged: `api.search(q)`, "See all N results" as today.
* **Files** — `api.files.list({ q, limit })`, new. A row opens the message the file is
  attached to (`showMessage(item.messageId)`), which is the done-when.
* **Actions** — the existing verbs, shown only under `scope = all`.

`Tab` cycles `all → channels → people → messages → files → all`; `Shift+Tab` goes back.
`Tab` is intercepted with `preventDefault()`, which is correct rather than a compromise:
this is a combobox, focus never leaves the input, and the option buttons become
`tabIndex={-1}` so they stop being tab stops that the a11y test's own preamble says they
should never have been. The input's `aria-label` names the live scope. **A phone has no Tab
key**, so the scope indicator is a `<button className="chip palette-scope">` that advances
on tap and joins the existing `@media (pointer: coarse)` 44 px list in `app.css:6118-6149`.
This is an addition to the section, made because the section's only control was a key.

"See all N" per section links to `/search?q=…&scope=…`.

### Client — `/search`

`SearchView` gains a **scope** pill row above its existing modifier row. The two are
different things and stay visibly different: `FILTERS` (`SearchView.tsx:22-26`) are
`has:` shortcuts and, with the sort group, **render only under `scope = messages`** — a
`has:link` filter over a list of channels is nonsense.

Scope vocabulary in the URL is `messages | channels | people | files`. `messages` is the
default and is **never written**, so `/search?q=x` keeps meaning exactly what it means
today and `parseRoute`/`pathForRoute` round-trip unambiguously. `scope=all` is a palette-only
state and never reaches a URL: the palette's Messages "See all N" keeps linking to the bare
`/search?q=`.

Under a non-message scope `SearchView` calls the same endpoints the palette does — files via
`api.files.list({ q })`, channels and people from the store — and renders `.browse-list` rows. `showChannelFromResult` and `showDirectMessage` move into
`lib/navigation.ts` so ⌘K and `/search` open a result by one rule rather than two copies.

## Rate-limit budget

Per keystroke, behind the existing 180 ms debounce and `live` guard:

| Scope | Requests | Metered |
|---|---|---|
| `all`, `q ≥ 2` | 2 (`/api/search`, `/api/attachments`) | 1 — `search`, 30 per 60 s |
| any narrowed scope | 1 | 1 if messages, else 0 |
| `q < 2`, or `only="people"` | 0 | 0 |

**The metered spend per keystroke is unchanged from today.** The two additions are unmetered
by the server; the `q ≥ 2` floor, the debounce and the scope gate are what keep them off the
database, and no new bucket is added. Adding one is named below as not done.

## A private channel never appears in a result the asker cannot see

Four mechanisms, one per section, all pre-existing:

* **Channels** — the store only ever held what `list_for_user` sent (`:52-54`): the
  asker's memberships plus unarchived public channels, and nothing else is read.
* **Files** — `listing()` inner-joins `channel_members` on the asker
  (`services/files.py:62-63`); a `channelId` the asker is not in raises `no_such_file()` →
  404 (`:49-50`), and a `q` alongside it changes nothing about that.
* **Messages** — unchanged.
* **People** — the roster is workspace-wide and carries no channel at all.

## Deliberately not doing

* **Calling `/api/channels/browse` from the palette or `/search`.** The store already holds
  every channel the asker may see, so the call added a request per keystroke and a second
  code path for nothing (finding 2).
* **`2e`'s "Blob answered" card with citations.** It is a fourth caller of `lib/llm.py`,
  which CLAUDE.md caps at three. That is an ADR, not a restyle.
* **A member-facing people search endpoint.** The roster already ships; a network round trip
  to filter an array the client holds would be slower and no more private.
* **A `total` on `GET /api/attachments`.** Files is keyset-paged and returns no count, so its
  "See all" row reads `See all files matching “deploy”` with no number where Messages and
  Channels carry an exact N. The asymmetry is visible and named rather than papered over.
* **A `browse` or `attachments` rate-limit bucket.** Nothing is metered on those routes
  today; this slice does not change that, and the client-side gate is the guard.
* **Accent folding on filenames.** See above.
* **Escaping `%`/`_` in either ILIKE.** Consistency with the channel browse beats a
  half-measure on one of two.

## Done when

Typing `deploy` in ⌘K shows four sections; `Tab` narrows to Files; a filename match opens the
message it is attached to; "See all" from any section lands on `/search?q=deploy&scope=…`
showing that kind; and an outsider's `q` against a private channel still answers 404.

## Verification

* **Backend:** `cd apps/api && uv run pytest tests/test_files_authz.py -q -n 4` — the
  filename filter narrows, matches mid-string and case-insensitively, a blank filter is the
  whole library, an outsider never sees a private channel's file by name, and an outsider's
  `q` on a private channel is still 404. Then `uv run alembic upgrade head && uv run alembic
  check` (must stay quiet) and `uv run pytest tests/test_openapi_contract.py -q` after
  `pnpm openapi`.
* **Frontend:** `cd apps/web && pnpm exec vitest run src/features/palette
  src/features/search/SearchView.test.tsx src/lib/router.test.ts`.
* **The gate:** `pnpm check`, `uv run alembic check`, `torsor guard --strict --severity error`.
* **In a browser:** ⌘K at 400 px and 1440 px — the scope button, the section headers and the
  "See all" rows must not push the input off the right edge and the results must not
  horizontal-scroll; `/search` at both widths with each of the four pills; the scope button
  tapped on a coarse pointer; `prefers-reduced-motion: reduce` (this slice adds no motion at
  all, which is the palette's standing rule in CLAUDE.md).
