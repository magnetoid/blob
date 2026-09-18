# Search scopes in ⌘K — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘K finds channels, people, messages and files in four headed sections, `Tab` narrows to one, and "See all" lands on `/search?q=&scope=` showing that kind.

**Architecture:** One backend change (a filename `q` on `GET /api/attachments`, backed by a pg_trgm GIN index and mirrored in `db/models.py`), then the palette fans out to the two endpoints it already has clients for plus the store, then `/search` grows the same four scopes as a page. Channels come from the public-only browse endpoint merged with the local store; people never leave the client.

**Tech Stack:** FastAPI + hand-written SQL via `text()`, Alembic 1.19, PostgreSQL with `pg_trgm`; React 19, zustand, vitest 2.1 with happy-dom (no jest-dom, no `user-event`).

**Spec:** `docs/superpowers/specs/2026-09-18-search-scopes-design.md` — binding.

## Global Constraints

- Branch `search-scopes` in the main checkout. One commit per task. Do not push; the controller does.
- **Routers hold no `text(`.** `torsor guard --strict --severity error` is a CI job and enforces it. SQL belongs in `services/`; the router shapes and authorizes.
- **`uv run alembic check` must stay quiet.** Every index added in a migration is mirrored in `apps/api/src/blob_api/db/models.py`. Ask `uv run alembic heads` before writing a `down_revision`; the head today is `0043` and this slice's number is **0044**.
- **Rate limits, verified in `apps/api/src/blob_api/lib/rate_limit.py:28-63`:** `search` is `Limit(30, 60)` (30 requests per 60 s, `:34`) and is consumed once, at `routers/search.py:61`. There is **no `browse` bucket and no `attachments` bucket** — `GET /api/channels/browse` (`routers/channels.py:50-65`) and `GET /api/attachments` (`routers/files.py:107-130`) call `consume` not at all. The only `consume` in `routers/files.py` is `upload` (`Limit(20, 60)`, `:33`) at `:138` and `:198`. **Do not add a bucket in this slice.**
- **The palette's existing guards are load-bearing and are reused, not replaced:** the 180 ms debounce (`CommandPalette.tsx:96`), the `live` out-of-order guard (`:84`, `:99`), the `q.length < 2` floor (`:80`) and the `only === "people"` early return (`:80`). Files fire only when `scope === "all" || scope === "files"`, and never when `only === "people"`; channels and people never leave the client (see the ruling below).
- **Every write is idempotent.** The only write here is migration 0044: `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`.
- **The 44 colour token names are a contract with `services/themes.py` and are not touched.** New CSS spends only existing tokens (`--hairline-soft`, `--accent`, `--text-label`, `--text-meta`, `--text-xs`, `--radius-*`). Motion: this slice adds **none** — "The palette gets no motion at all" (CLAUDE.md). No new `--dur-*`, no literal `ms`, no `cubic-bezier`.
- **A private channel never appears in a result the asker cannot see.** Channels come from the store, which holds exactly what `list_for_user` sent — the asker's memberships plus every unarchived public channel (`services/channels.py:43-61`) — so a private channel the asker is not in is never there; files come from `listing()`, which inner-joins `channel_members` on the asker (`services/files.py:62-63`) and 404s a channel they are not in (`:49-50`). Do not widen either.
- **Private channels answer 404, never 403.** `no_such_file()` is the existing helper.
- Tests: backend `cd apps/api && uv run pytest tests/<file> -q -n 4`; frontend `cd apps/web && pnpm exec vitest run <file>`. Frontend tests declare `// @vitest-environment happy-dom` at the top, use `fireEvent` and roles, and have **no** jest-dom matchers available — assert with `toBeTruthy()`, `toBeNull()` and `.textContent`.
- The gate before each commit, from the repo root: `pnpm check`, then `cd apps/api && uv run alembic check`, then `torsor guard --strict --severity error $(git ls-files '*.py')`.
- `.torsor/map` timestamps churn on every commit: `git checkout -- .torsor/map` before staging.

- **Ruling (controller, 2026-09-18) — channels never leave the client.** `services/channels.py:43-61` (`list_for_user`) already sends every channel the asker is in plus every unarchived public one, and `channel.created` keeps the store current, so the store *is* the asker's whole reach and `/api/channels/browse` would return a subset of it. The palette and `/search?scope=channels` filter the store; there is no `browse` call, no `browsed` state, no browse effect, no `BrowsableChannel` import, no browse mock and no browse assertion anywhere in this slice. A private channel the asker is not in is never in the store to show. Under `scope = all` the palette makes **two** requests (`/api/search`, `/api/attachments`), not three.
- **Ruling — Files carries no count.** `GET /api/attachments` is keyset-paged and returns no total; the Files "See all" row reads `See all files matching “deploy”` and asks for one row more than it shows. No `COUNT(*)` is added.
- **Ruling — filenames are not accent-folded.** Plain `ILIKE`, as the design says; recorded as not done.

---

### Task 1: A filename is searchable

**Files:**
- Modify: `apps/api/src/blob_api/services/files.py:22-99` (`listing`)
- Modify: `apps/api/src/blob_api/routers/files.py:107-130` (`list_attachments`)
- Modify: `apps/api/src/blob_api/db/models.py:1-12` (module docstring) and `:477-491` (`Attachment.__table_args__`)
- Create: `apps/api/src/blob_api/db/migrations/versions/0044_attachment_filename_trgm.py`
- Test: `apps/api/tests/test_files_authz.py`
- Regenerate: `packages/shared/openapi.json` (via `pnpm openapi`)

**Interfaces:**
- Produces: `file_service.listing(session, user, *, channel_id, kind, cursor, limit, q: str | None = None)` — `q` is a case-insensitive substring of `attachments.filename`; `None` means no filter.
- Produces: `GET /api/attachments?q=<str>` — optional, `max_length=100`, blank is treated as absent. Response shape is unchanged (`FileListOut` = `items: FileEntry[]`, `nextCursor`).

- [ ] **Step 1: Give the test helper a filename.** In `apps/api/tests/test_files_authz.py`, `_plant_attachment` (`:23-46`) hard-codes `'shot.png'`. Add a keyword-only parameter so existing callers are untouched:

```python
async def _plant_attachment(
    workspace_id: str,
    uploader_id: str,
    *,
    message_id: str | None = None,
    filename: str = "shot.png",
) -> tuple[str, str]:
    attachment_id = new_id()
    object_key = f"{workspace_id}/test/{attachment_id}.png"
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO attachments
                  (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes,
                   message_id)
                VALUES (:id, :ws, :up, :key, :filename, 'image/png', 1234, :message_id)
                """
            ),
            {
                "id": attachment_id,
                "ws": workspace_id,
                "up": uploader_id,
                "key": object_key,
                "filename": filename,
                "message_id": message_id,
            },
        )
    return attachment_id, object_key
```

- [ ] **Step 2: Write the failing tests.** Append to `apps/api/tests/test_files_authz.py`:

```python
class TestFilenameFilter:
    """`q` over `attachments.filename`, which is what ⌘K's Files section asks for.

    The last test is the one worth the class: a filter is a new way to ask a question,
    and a new way to ask must not be a new way to learn that a private channel exists.
    """

    async def test_a_filename_filter_narrows_the_library(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "two files")
        message_id = sent.body["message"]["id"]
        wanted, _ = await _plant_attachment(
            team["workspace"], team["owner"].user_id,
            message_id=message_id, filename="deploy-runbook.pdf",
        )
        other, _ = await _plant_attachment(
            team["workspace"], team["owner"].user_id,
            message_id=message_id, filename="holiday-photo.png",
        )

        response = await team["member"].get("/api/attachments?q=deploy")
        assert response.status == 200, response.body
        ids = [item["id"] for item in response.body["items"]]
        assert wanted in ids
        assert other not in ids

    async def test_the_filter_matches_the_middle_of_a_name_and_ignores_case(
        self, team: dict
    ) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "one file")
        wanted, _ = await _plant_attachment(
            team["workspace"], team["owner"].user_id,
            message_id=sent.body["message"]["id"], filename="Q3-DEPLOY-notes.md",
        )

        response = await team["member"].get("/api/attachments?q=deploy-no")
        assert response.status == 200, response.body
        assert wanted in [item["id"] for item in response.body["items"]]

    async def test_a_blank_filter_is_the_whole_library(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "one file")
        wanted, _ = await _plant_attachment(
            team["workspace"], team["owner"].user_id,
            message_id=sent.body["message"]["id"], filename="anything.png",
        )

        response = await team["member"].get("/api/attachments?q=")
        assert response.status == 200, response.body
        assert wanted in [item["id"] for item in response.body["items"]]

    async def test_an_outsider_never_sees_a_private_channels_file_by_name(
        self, team: dict
    ) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "secret")
        hidden, _ = await _plant_attachment(
            team["workspace"], team["owner"].user_id,
            message_id=sent.body["message"]["id"], filename="deploy-secrets.env",
        )

        response = await team["outsider"].get("/api/attachments?q=deploy")
        assert response.status == 200, response.body
        assert hidden not in [item["id"] for item in response.body["items"]]

    async def test_an_outsiders_filter_on_a_private_channel_still_answers_404(
        self, team: dict
    ) -> None:
        # 404, not 403 and not an empty list: the channel's existence is the private
        # part, and a filter must not become a way to probe for it.
        channel_id = team["private"]["id"]
        response = await team["outsider"].get(
            f"/api/attachments?channelId={channel_id}&q=deploy"
        )
        assert response.status == 404, response.body
```

- [ ] **Step 3: Run them and watch them fail.**

Run: `cd apps/api && uv run pytest tests/test_files_authz.py::TestFilenameFilter -q -n 4`
Expected: FAIL — the first four return unfiltered lists (`other` is present, `hidden` is present); the fifth already passes, which is correct and is the regression guard.

- [ ] **Step 4: Add `q` to the service.** In `apps/api/src/blob_api/services/files.py`, add the parameter to `listing`'s signature after `limit: int`:

```python
    limit: int,
    #: Case-insensitive substring of the filename. None means no filter — `''` would
    #: match every row through the LIKE and is normalised away in the router.
    q: str | None = None,
) -> tuple[list[Any], str | None]:
```

Add the predicate immediately after the `kind` block and before the `cursor` block, in the same `CAST(... AS ...) IS NULL OR` idiom the `channel_id` branch uses:

```sql
                   AND (
                        CAST(:q AS text) IS NULL
                        OR a.filename ILIKE '%' || CAST(:q AS text) || '%'
                   )
```

and add `"q": q,` to the parameter dict beside `"kind": kind,`.

- [ ] **Step 5: Add `q` to the router.** In `apps/api/src/blob_api/routers/files.py`, extend `list_attachments`:

```python
@router.get("/api/attachments", response_model=FileListOut)
async def list_attachments(
    user: SessionUser = Depends(current_user),
    channel_id: str | None = Query(None, alias="channelId"),
    kind: str = Query("all"),
    cursor: str | None = None,
    limit: int = Query(40, ge=1, le=100),
    q: str | None = Query(None, max_length=100),
) -> FileListOut:
```

and inside, after the `cursor` validation:

```python
    # Blank is absent: `''` would go into the LIKE as '%%' and match everything, which
    # is the same answer but a sequential scan to get there.
    needle = q.strip() if q else None

    async with session_scope() as session:
        page, next_cursor = await file_service.listing(
            session,
            user,
            channel_id=channel_id,
            kind=kind,
            cursor=cursor,
            limit=limit,
            q=needle or None,
        )
```

- [ ] **Step 6: Write migration 0044.** Create `apps/api/src/blob_api/db/migrations/versions/0044_attachment_filename_trgm.py`:

```python
"""A filename is searchable.

⌘K gains a Files section, which asks `attachments.filename ILIKE '%term%'` — a pattern
with a leading wildcard, which no b-tree can answer. `pg_trgm` has been installed since
0032 (it is what lets three letters of `šta` find a message), so this is an index and not
an extension.

The opclass goes on the column rather than on an expression. pg_trgm folds case itself,
so `ILIKE` uses this index unchanged and no `lower()` wrapper is needed; and a plain
column index reflects as a column index, which is what keeps `alembic check` quiet
against the mirror in `db/models.py`.

Filenames are not accent-folded. Message bodies are, through the generated `search_tsv`
and `blob_unaccent`, but that fold is a stored column with its own index; a filename has
neither, and adding one is a bigger change than this slice.

Revision ID: 0044
Revises: 0043
"""

from __future__ import annotations

from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS attachments_filename_trgm
            ON attachments USING gin (filename gin_trgm_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS attachments_filename_trgm")
```

- [ ] **Step 7: Mirror the index in the models.** In `apps/api/src/blob_api/db/models.py`, add to `Attachment.__table_args__` (`:479-491`), after the `attachments_object_key` line:

```python
        # ⌘K's Files section filters on the name: `ILIKE '%term%'` cannot use a b-tree,
        # and pg_trgm is installed (0032). Mirrors 0044 — `alembic check` compares an
        # index by name, columns and uniqueness, all of which this reflects cleanly.
        Index(
            "attachments_filename_trgm",
            "filename",
            postgresql_using="gin",
            postgresql_ops={"filename": "gin_trgm_ops"},
        ),
```

Add one bullet to the module docstring's fidelity list (`:5-8`), after the GIN line — the counts already in that list ("Two are GIN", "Five are partial") are stale and fixing them is not this slice's job, so add a kind rather than edit a number:

```python
  * One carries a non-default operator class — `postgresql_ops=`.
```

- [ ] **Step 8: Migrate, then run the tests.**

Run: `cd apps/api && uv run alembic upgrade head && uv run pytest tests/test_files_authz.py -q -n 4`
Expected: PASS, all of `TestFilenameFilter` plus the existing classes.

- [ ] **Step 9: Prove there is no schema drift.**

Run: `cd apps/api && uv run alembic check`
Expected: no output beyond the "No new upgrade operations detected." line. If it instead proposes creating or dropping `attachments_filename_trgm`, the mirror is wrong: replace the model index with the expression form that `messages_body_trgm` (`models.py:386-390`) already proves quiet —

```python
        Index(
            "attachments_filename_trgm",
            text("filename gin_trgm_ops"),
            postgresql_using="gin",
        ),
```

and re-run `uv run alembic check` before going on.

- [ ] **Step 10: Regenerate the contract.** A new query parameter changes the OpenAPI document, and `tests/test_openapi_contract.py` fails until the checked-in file matches. This must happen in this task, not a later one, or Task 1 ends red.

Run: `pnpm openapi` from the repo root, then `cd apps/api && uv run pytest tests/test_openapi_contract.py -q`
Expected: PASS, with `packages/shared/openapi.json` showing a `q` parameter on `/api/attachments`.

- [ ] **Step 11: Gate and commit.**

```bash
pnpm check
cd apps/api && uv run alembic check
torsor guard --strict --severity error $(git ls-files '*.py')
git checkout -- .torsor/map
git add apps/api/src/blob_api/services/files.py apps/api/src/blob_api/routers/files.py \
        apps/api/src/blob_api/db/models.py \
        apps/api/src/blob_api/db/migrations/versions/0044_attachment_filename_trgm.py \
        apps/api/tests/test_files_authz.py packages/shared/openapi.json
git commit -m "feat: filter the files library by filename"
```

---

### Task 2: ⌘K in four sections, with Tab to narrow

**Files:**
- Modify: `apps/web/src/lib/api.ts:640-651` (`files.list`)
- Modify: `apps/web/src/lib/navigation.ts` (two new exported helpers)
- Modify: `apps/web/src/features/palette/CommandPalette.tsx` (whole file)
- Modify: `apps/web/src/styles/app.css:2470-2563` (the command palette block) and `:6118-6149` (the coarse-pointer block)
- Test: `apps/web/src/features/palette/CommandPalette.search.test.tsx`

**Interfaces:**
- Consumes (Task 1): `GET /api/attachments?q=<str>&limit=<int>` returning `{ items: FileEntry[], nextCursor: string | null }`. `FileEntry` is `packages/shared/src/types.ts:194-198` — `Attachment` plus `channelId`, `messageId`, `createdAt`.
- Produces: `api.files.list({ channelId?, kind?, cursor?, q?, limit? })`.
- Produces, in `apps/web/src/lib/navigation.ts`:
  - `showChannelFromResult(channelId: string, options: { joined: boolean; kind: string }): Promise<void>`
  - `showDirectMessage(userId: string): Promise<void>`
  Task 3 uses both.
- Produces: `/search?q=<term>&scope=channels|people|files` as the target of every "See all" row. Task 3 makes that URL mean something; until then it opens the message search, which is the behaviour today.

- [ ] **Step 1: Widen `api.files.list`.** In `apps/web/src/lib/api.ts`, replace the `files` block (`:640-651`):

```ts
  files: {
    list: (
      query: {
        channelId?: string;
        kind?: "all" | "image" | "file" | "voice";
        cursor?: string;
        /** Filename contains, case-insensitive. ⌘K's Files section and /search?scope=files. */
        q?: string;
        /** Ask for one more than you will show, and a row came back means "there is more". */
        limit?: number;
      } = {},
    ) => {
      const params = new URLSearchParams();
      if (query.channelId) params.set("channelId", query.channelId);
      if (query.kind && query.kind !== "all") params.set("kind", query.kind);
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.q) params.set("q", query.q);
      if (query.limit) params.set("limit", String(query.limit));
      const suffix = params.size ? `?${params}` : "";
      return get<{ items: FileEntry[]; nextCursor: string | null }>(`/api/attachments${suffix}`);
    },
  },
```

- [ ] **Step 2: Move "open a result" into `navigation.ts`.** Append to `apps/web/src/lib/navigation.ts` (it already imports `api`, `useStore` and `showChannel`'s dependencies):

```ts
/**
 * Open a channel somebody found, joining a public one they are not in first.
 *
 * ⌘K and /search both land here, so "found it" and "in it" are one step and one rule.
 * A private channel can only be in a result the asker is already a member of, which is
 * why `joined` is enough and the kind check is belt and braces.
 */
export async function showChannelFromResult(
  channelId: string,
  options: { joined: boolean; kind: string },
): Promise<void> {
  if (!options.joined && options.kind === "public") {
    const { channel } = await api.channels.join(channelId);
    useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
  }
  await showChannel(channelId);
}

/** Open the DM with somebody, creating it if this is the first message. */
export async function showDirectMessage(userId: string): Promise<void> {
  const { channel } = await api.dms.open([userId]);
  useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
  await showChannel(channel.id);
}
```

- [ ] **Step 3: Write the failing tests.** In `apps/web/src/features/palette/CommandPalette.search.test.tsx`, extend the module mock at the top (`:19-30`) and add a describe block. Replace the mock preamble with:

```tsx
const search = vi.fn();
const listFiles = vi.fn();
const showMessage = vi.fn(async () => true);
const navigate = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      search,
      files: { ...actual.api.files, list: listFiles },
    },
  };
});

vi.mock('../../lib/navigation.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/navigation.ts')>();
  return { ...actual, showMessage };
});

vi.mock('../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.ts')>();
  return { ...actual, navigate };
});
```

and extend `beforeEach` to `search.mockReset(); listFiles.mockReset(); showMessage.mockReset(); navigate.mockReset();` with default empty answers so existing tests do not see `undefined`:

```tsx
beforeEach(() => {
  search.mockReset();
  listFiles.mockReset();
  showMessage.mockReset();
  navigate.mockReset();
  search.mockResolvedValue({ messages: [], total: 0 });
  listFiles.mockResolvedValue({ items: [], nextCursor: null });
});
```

Then append:

```tsx
const file = (id: string, filename: string, messageId: string) => ({
  id,
  filename,
  mime: 'application/pdf',
  sizeBytes: 100,
  width: null,
  height: null,
  url: `/api/files/${id}`,
  thumbUrl: null,
  kind: 'file',
  durationMs: null,
  waveform: null,
  transcriptStatus: 'none',
  transcriptProvider: null,
  channelId: 'c1',
  messageId,
  createdAt: '2026-09-01T10:00:00.000Z',
});

describe('search scopes', () => {
  it('draws a section for each kind of thing', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'the deploy gate')], total: 1 });
    listFiles.mockResolvedValue({ items: [file('f1', 'deploy-runbook.pdf', 'm1')], nextCursor: null });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy());
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('Files')).toBeTruthy();
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ q: 'deploy' }));
  });

  it('Tab narrows the search, and says so', async () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });

    expect(input.getAttribute('aria-label')).toContain('everything');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('channels');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('people');
    // And back, so the cycle is walkable in both directions.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(input.getAttribute('aria-label')).toContain('channels');
  });

  it('Tab reaches Files, and a filename opens the message it is attached to', async () => {
    listFiles.mockResolvedValue({ items: [file('f1', 'deploy-runbook.pdf', 'm7')], nextCursor: null });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('files');

    await waitFor(() => expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy());
    // Narrowed to one section, only that section's request goes out.
    expect(search).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('deploy-runbook.pdf'));
    await waitFor(() => expect(showMessage).toHaveBeenCalledWith('m7'));
  });

  it('does not ask for files for one character', async () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'd' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('never lists a private channel the asker is not in', async () => {
    // The store holds exactly the asker's reach (memberships plus public channels), and
    // the palette reads nothing else for channels — so there is no second path to leak.
    const input = open();
    fireEvent.change(input, { target: { value: 'secret' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText('#secret-plans')).toBeNull();
  });

  it('asks the server for nothing when it is a people picker', async () => {
    const input = open('people');
    fireEvent.change(input, { target: { value: 'deploy' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('sends See all files to the search page with the files scope', async () => {
    listFiles.mockResolvedValue({
      items: [
        file('f1', 'deploy-1.pdf', 'm1'),
        file('f2', 'deploy-2.pdf', 'm2'),
        file('f3', 'deploy-3.pdf', 'm3'),
        file('f4', 'deploy-4.pdf', 'm4'),
        file('f5', 'deploy-5.pdf', 'm5'),
        file('f6', 'deploy-6.pdf', 'm6'),
      ],
      nextCursor: null,
    });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getByText(/See all files/)).toBeTruthy());
    fireEvent.click(screen.getByText(/See all files/));

    expect(navigate).toHaveBeenCalledWith('/search?q=deploy&scope=files');
  });
});
```

- [ ] **Step 4: Run them and watch them fail.**

Run: `cd apps/web && pnpm exec vitest run src/features/palette/CommandPalette.search.test.tsx`
Expected: FAIL — no `Channels`/`Files` headers, `aria-label` is null, `listFiles` is never called.

- [ ] **Step 5: Add the scope vocabulary and the two new state slots.** At the top of `apps/web/src/features/palette/CommandPalette.tsx`, beside the `Item` interface, replace it and add:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, Message } from "@blob/shared";
import { showChannelFromResult, showDirectMessage, showMessage } from "../../lib/navigation.ts";

/** The sections, in the order they are drawn — which is also the order Tab walks. */
type Section = "Channels" | "People" | "Messages" | "Files" | "Actions";

const SCOPES = ["all", "channels", "people", "messages", "files"] as const;
type PaletteScope = (typeof SCOPES)[number];

/** What the input's accessible name says it is searching. */
const SCOPE_LABEL: Record<PaletteScope, string> = {
  all: "everything",
  channels: "channels",
  people: "people",
  messages: "messages",
  files: "files",
};

interface Item {
  id: string;
  label: string;
  kind: "Channel" | "Person" | "Action" | "Message" | "File";
  section: Section;
  hint?: string;
  run: () => void | Promise<void>;
}
```

Inside the component, beside the existing `found` state:

```tsx
  const [scope, setScope] = useState<PaletteScope>("all");
  const [files, setFiles] = useState<FileEntry[]>([]);
```

- [ ] **Step 6: Gate the message effect on scope, and add the two new ones.** Change the guard in the existing search effect (`:79-83`) to include the scope, and add two effects with the identical debounce-and-`live` shape beside it:

```tsx
  /** Whether a section's own request should go out at all. */
  function fetches(section: PaletteScope): boolean {
    return scope === "all" || scope === section;
  }
```

Declare that as a module-level helper instead, so it does not change identity per render:

```tsx
function fetches(scope: PaletteScope, section: PaletteScope): boolean {
  return scope === "all" || scope === section;
}
```

The message effect's guard becomes:

```tsx
    if (only === "people" || q.length < 2 || !fetches(scope, "messages")) {
      setFound({ messages: [], total: 0 });
      return;
    }
```

with `scope` added to its dependency array. Then, immediately after it:

```tsx
  /** Files by name. One more than is shown, so "there is more" needs no count. */
  useEffect(() => {
    const q = query.trim();
    if (only === "people" || q.length < 2 || !fetches(scope, "files")) {
      setFiles([]);
      return;
    }
    let live = true;
    const wanted = scope === "files" ? 13 : 6;
    const timer = setTimeout(() => {
      void api.files
        .list({ q, limit: wanted })
        .then((result) => {
          if (live) setFiles(result.items);
        })
        .catch(() => {
          if (live) setFiles([]);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, only, scope]);
```

- [ ] **Step 7: Tag the existing items with their section and add the file items.** In the `items` memo, add `section: "Channels"` to each channel item, `section: "People"` to each person item and `section: "Actions"` to each action item, and replace the two inline `run` bodies with the helpers from Step 2:

```tsx
    const channelItems: Item[] = Object.values(channels)
      .filter((c) => !c.archivedAt)
      .map((channel) => ({
        id: `c-${channel.id}`,
        label: channel.name ? `#${channel.name}` : channelTitle(channel),
        kind: "Channel",
        section: "Channels",
        hint: channel.membership ? undefined : "not joined",
        run: () =>
          showChannelFromResult(channel.id, {
            joined: channel.membership !== null,
            kind: channel.kind,
          }),
      }));

    const peopleItems: Item[] = Object.values(users)
      .filter((u) => !u.deactivated && u.id !== currentUser?.id)
      .map((person) => ({
        id: `u-${person.id}`,
        label: person.displayName,
        kind: "Person",
        section: "People",
        run: () => showDirectMessage(person.id),
      }));
```

Add `section: "Messages"` to `messageItems` (`:201-221`), raise its slice from 6 to 13, and add a files memo beside it:

```tsx
  const fileItems = useMemo<Item[]>(
    () =>
      files.map((entry) => {
        const channel = channels[entry.channelId];
        const where = channel
          ? channel.name
            ? `#${channel.name}`
            : channelTitle(channel)
          : "a conversation";
        return {
          id: `f-${entry.id}`,
          label: entry.filename,
          kind: "File",
          section: "Files",
          hint: where,
          run: async () => {
            // The file is not the destination — the message that carries it is, which is
            // where it can be read in the conversation it was posted into.
            await showMessage(entry.messageId);
          },
        };
      }),
    [files, channels, channelTitle],
  );
```

- [ ] **Step 8: Assemble the sections.** Replace the `matches` memo (`:223-248`) with:

```tsx
  const matches = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, "");
    const wanted = (section: Section) =>
      scope === "all" ||
      (scope === "channels" && section === "Channels") ||
      (scope === "people" && section === "People") ||
      (scope === "messages" && section === "Messages") ||
      (scope === "files" && section === "Files");

    if (!q) {
      // With nothing typed this is still the jump list it has always been.
      return [...channelItems, ...peopleItems, ...actionItems]
        .filter((item) => wanted(item.section))
        .slice(0, 12);
    }

    const rank = (list: Item[]) =>
      list
        .map((item) => ({ item, s: score(item.label.toLowerCase(), q) }))
        .filter((entry) => entry.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((entry) => entry.item);

    const room = (section: Section) => (scope === "all" ? 5 : 12);
    const out: Item[] = [];
    const seeAll = (section: Section, label: string, target: string): Item => ({
      id: `see-${section}`,
      label,
      kind: "Action",
      section,
      // The page, not the popup: modifiers, sorting and paging live there, and the URL
      // is the thing somebody sends to a colleague.
      run: () => navigate(target),
    });
    const term = encodeURIComponent(query.trim());

    if (wanted("Channels")) {
      const all = rank(channelItems);
      const shown = all.slice(0, room("Channels"));
      out.push(...shown);
      if (all.length > shown.length) {
        out.push(
          seeAll("Channels", `See all ${all.length} channels`, `/search?q=${term}&scope=channels`),
        );
      }
    }
    if (wanted("People")) {
      const all = rank(peopleItems);
      const shown = all.slice(0, room("People"));
      out.push(...shown);
      if (all.length > shown.length) {
        out.push(
          seeAll("People", `See all ${all.length} people`, `/search?q=${term}&scope=people`),
        );
      }
    }
    if (wanted("Messages")) {
      // Server-ranked: never re-sorted here, or the palette would disagree with /search.
      const shown = messageItems.slice(0, room("Messages"));
      out.push(...shown);
      if (found.total > shown.length) {
        out.push(
          seeAll(
            "Messages",
            `See all ${found.total} results for “${query.trim()}”`,
            `/search?q=${term}`,
          ),
        );
      }
    }
    if (wanted("Files")) {
      const shown = fileItems.slice(0, room("Files"));
      out.push(...shown);
      // No count: /api/attachments is keyset-paged and returns no total, so the row asks
      // for one more than it shows and says "more" rather than inventing a number.
      if (fileItems.length > shown.length) {
        out.push(
          seeAll("Files", `See all files matching “${query.trim()}”`, `/search?q=${term}&scope=files`),
        );
      }
    }
    if (wanted("Actions")) out.push(...rank(actionItems).slice(0, 5));

    return out;
  }, [
    query,
    scope,
    channelItems,
    peopleItems,
    actionItems,
    messageItems,
    fileItems,
    found.total,
  ]);
```

Split the existing `items` memo into `channelItems`, `peopleItems` and `actionItems` memos so this can read them separately, and keep the `only === "people"` early return by making `wanted` answer `false` for everything but `People` when `only === "people"`.

- [ ] **Step 9: Bind Tab, name the scope, and render the headers.** In the input's `onKeyDown`, after the `Enter` branch:

```tsx
            } else if (event.key === "Tab" && !only) {
              // Tab is the scope key here, not a focus key. This is a combobox: focus
              // never leaves the input, and the options are not tab stops (tabIndex -1
              // below), so nothing is taken away by claiming it.
              event.preventDefault();
              setIndex(0);
              setScope((current) => {
                const at = SCOPES.indexOf(current);
                const next = event.shiftKey ? at - 1 + SCOPES.length : at + 1;
                return SCOPES[next % SCOPES.length]!;
              });
            }
```

Give the input its accessible name and wrap it with the scope button:

```tsx
        <div className="palette-field">
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            role="combobox"
            aria-label={
              only === "people"
                ? "Message someone"
                : `Search ${SCOPE_LABEL[scope]} — Tab changes what is searched`
            }
            /* …the rest of the existing props, unchanged… */
          />
          {!only && (
            /* A phone has no Tab key, so the indicator is also the control. */
            <button
              type="button"
              className="chip palette-scope"
              onClick={() => {
                setIndex(0);
                setScope((current) => SCOPES[(SCOPES.indexOf(current) + 1) % SCOPES.length]!);
              }}
            >
              ⇥ {SCOPE_LABEL[scope]}
            </button>
          )}
        </div>
```

and emit a header whenever the section changes, with `tabIndex={-1}` on the option:

```tsx
            matches.map((item, i) => (
              <Fragment key={item.id}>
                {item.section !== matches[i - 1]?.section && (
                  /* Presentational: each row already announces its kind through the
                     badge, so the listbox stays a flat list of options. */
                  <div className="palette-section" aria-hidden="true">
                    {item.section}
                  </div>
                )}
                <button
                  id={`palette-option-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === index}
                  className="palette-item"
                  data-active={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => void choose(item)}
                >
                  {/* …the existing row contents, unchanged… */}
                </button>
              </Fragment>
            ))
```

- [ ] **Step 10: The CSS.** In `apps/web/src/styles/app.css`, in the command-palette block (`:2470-2563`), move the bottom rule off `.palette-input` onto a new flex row and add two rules. Only existing tokens; no motion:

```css
/* The input and what Tab is narrowing to, on one line: the key and its effect in the
   same place. The bottom rule moved here from .palette-input so the scope control sits
   above it rather than beside a rule that stops short. */
.palette-field {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--hairline-soft);
}

.palette-field:focus-within {
  border-bottom-color: var(--accent);
}

.palette-field .palette-input {
  flex: 1;
  min-width: 0;
  border-bottom: 0;
}

.palette-scope {
  flex: none;
  margin-right: 14px;
}

/* A section header inside the results. The rows already carry their kind badge, which is
   what a screen reader announces, so this is aria-hidden and adds no ARIA structure. */
.palette-section {
  padding: 10px 10px 4px;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-label);
}
```

Delete the now-dead `.palette-input:focus { border-bottom-color: … }` and the `border-bottom` line inside `.palette-input`. Add `.palette-scope` to the coarse-pointer list at `:6127-6136`:

```css
  .btn,
  .channel-row,
  .palette-scope,
  .sidebar-add,
```

- [ ] **Step 11: Run the tests.**

Run: `cd apps/web && pnpm exec vitest run src/features/palette/CommandPalette.search.test.tsx src/features/palette/CommandPalette.a11y.test.tsx`
Expected: PASS — including the three a11y tests, which are the guard that the flat option list and `aria-activedescendant` survived the sectioning.

- [ ] **Step 12: Gate and commit.**

```bash
pnpm check
torsor guard --strict --severity error $(git ls-files '*.py')
git checkout -- .torsor/map
git add apps/web/src/lib/api.ts apps/web/src/lib/navigation.ts \
        apps/web/src/features/palette/CommandPalette.tsx \
        apps/web/src/features/palette/CommandPalette.search.test.tsx \
        apps/web/src/styles/app.css
git commit -m "feat: ⌘K in four sections, with Tab to narrow"
```

---

### Task 3: /search carries the scope

**Files:**
- Modify: `apps/web/src/lib/router.ts:80` (the `search` route), `:141-146` (`parseRoute`), `:234-235` (`pathForRoute`)
- Modify: `apps/web/src/app/Workspace.tsx:491`
- Modify: `apps/web/src/features/search/SearchView.tsx`
- Test: `apps/web/src/lib/router.test.ts`, `apps/web/src/features/search/SearchView.test.tsx`

**Interfaces:**
- Consumes (Task 2): `showChannelFromResult(channelId, { joined, kind })` and `showDirectMessage(userId)` from `apps/web/src/lib/navigation.ts`; `api.files.list({ q })`.
- Produces: `export type SearchScope = 'messages' | 'channels' | 'people' | 'files'` from `apps/web/src/lib/router.ts`; `Route` gains `{ view: 'search'; query?: string; scope?: SearchScope }`; `SearchView` gains `initialScope?: SearchScope`.
- `messages` is the default and is **never written into a URL**, so `/search?q=x` keeps meaning today's screen and the round-trip is one-to-one.

- [ ] **Step 1: Write the failing router tests.** Append to `apps/web/src/lib/router.test.ts`:

```ts
describe('a search carries its scope', () => {
  it('reads the scope out of the URL', () => {
    expect(parseRoute('/search?q=deploy&scope=files')).toEqual({
      view: 'search',
      query: 'deploy',
      scope: 'files',
    });
    expect(parseRoute('/search?q=deploy&scope=channels')).toEqual({
      view: 'search',
      query: 'deploy',
      scope: 'channels',
    });
  });

  it('never writes the default scope, so one screen has one URL', () => {
    expect(pathForRoute({ view: 'search', query: 'deploy', scope: 'messages' })).toBe(
      '/search?q=deploy',
    );
    expect(parseRoute('/search?q=deploy&scope=messages')).toEqual({
      view: 'search',
      query: 'deploy',
    });
  });

  it('ignores a scope nobody serves', () => {
    expect(parseRoute('/search?q=deploy&scope=nonsense')).toEqual({
      view: 'search',
      query: 'deploy',
    });
  });

  it('round-trips a scoped search', () => {
    const route = parseRoute('/search?q=from%3A%40ana%20deploy&scope=files');
    expect(pathForRoute(route)).toBe('/search?q=from%3A%40ana%20deploy&scope=files');
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `cd apps/web && pnpm exec vitest run src/lib/router.test.ts`
Expected: FAIL — `parseRoute` drops `scope` entirely.

- [ ] **Step 3: Teach the router the scope.** In `apps/web/src/lib/router.ts`, above the `Route` union:

```ts
/**
 * What a /search URL is looking through.
 *
 * `messages` is the default and is never written, so `/search?q=x` means exactly what it
 * has always meant and no screen has two URLs. The palette's own fifth state, `all`, is a
 * popup thing and never reaches a link.
 */
export type SearchScope = 'messages' | 'channels' | 'people' | 'files';

const SEARCH_SCOPES: readonly string[] = ['messages', 'channels', 'people', 'files'];
```

Change the union member at `:80` to `| { view: 'search'; query?: string; scope?: SearchScope }`, and `parseRoute`'s `/search` branch to:

```ts
  if (clean === '/search') {
    // Shareable and bookmarkable, the way Slack's is: the search someone sent you
    // opens as the search they ran, looking through what they were looking through.
    const query = params.get('q') ?? '';
    const asked = params.get('scope');
    const scope =
      asked && asked !== 'messages' && SEARCH_SCOPES.includes(asked)
        ? (asked as SearchScope)
        : undefined;
    if (query) return scope ? { view: 'search', query, scope } : { view: 'search', query };
    return scope ? { view: 'search', scope } : { view: 'search' };
  }
```

and `pathForRoute`'s case at `:234-235` to — note this stays a hand-built string, because
`URLSearchParams` writes a space as `+` and `router.test.ts:196-200` pins `%20`:

```ts
    case 'search': {
      const scope = route.scope && route.scope !== 'messages' ? `scope=${route.scope}` : '';
      if (!route.query) return scope ? `/search?${scope}` : '/search';
      return `/search?q=${encodeURIComponent(route.query)}${scope ? `&${scope}` : ''}`;
    }
```

- [ ] **Step 4: Run the router tests.**

Run: `cd apps/web && pnpm exec vitest run src/lib/router.test.ts`
Expected: PASS, including the existing `round-trips every route` and `%20` assertions.

- [ ] **Step 5: Write the failing SearchView tests.** In `apps/web/src/features/search/SearchView.test.tsx`, widen the module mock (`:18-23`) — it currently exposes only `search`, which is why nothing else may be called under the default scope:

```tsx
const search = vi.fn();
const listFiles = vi.fn();
const navigate = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      search: (...args: unknown[]) => search(...(args as [])),
      files: { list: (...args: unknown[]) => listFiles(...(args as [])) },
    },
  };
});

vi.mock('../../lib/navigation.ts', () => ({
  showMessage: vi.fn(),
  showChannelFromResult: vi.fn(),
  showDirectMessage: vi.fn(),
}));

vi.mock('../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.ts')>();
  return { ...actual, navigate };
});
```

Add `listFiles.mockReset(); navigate.mockReset();` to `beforeEach`, and append:

```tsx
describe('search scopes', () => {
  it('searches messages and nothing else by default', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'a result')], total: 1, nextCursor: null });

    render(<SearchView />);
    await type('deploy');

    expect(search).toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('lists filenames when the URL asked for files', async () => {
    listFiles.mockResolvedValue({
      items: [
        {
          id: 'f1',
          filename: 'deploy-runbook.pdf',
          mime: 'application/pdf',
          sizeBytes: 10,
          width: null,
          height: null,
          url: '/api/files/f1',
          thumbUrl: null,
          kind: 'file',
          durationMs: null,
          waveform: null,
          transcriptStatus: 'none',
          transcriptProvider: null,
          channelId: 'c1',
          messageId: 'm9',
          createdAt: '2026-09-01T09:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    render(<SearchView initialScope="files" />);
    await type('deploy');

    expect(listFiles).toHaveBeenCalledWith({ q: 'deploy' });
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy();
  });

  it('puts the chosen scope in the URL', async () => {
    render(<SearchView />);
    await type('deploy');
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));

    expect(navigate).toHaveBeenCalledWith('/search?q=deploy&scope=files', { replace: true });
  });

  it('keeps the has: filters and the sort on messages only', async () => {
    render(<SearchView initialScope="files" />);
    await type('deploy');

    // `has:link` over a list of filenames is not a narrowing, it is nonsense.
    expect(screen.queryByRole('button', { name: 'Has link' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sort results' })).toBeNull();
  });
});
```

- [ ] **Step 6: Run them and watch them fail.**

Run: `cd apps/web && pnpm exec vitest run src/features/search/SearchView.test.tsx`
Expected: FAIL — `SearchView` has no `initialScope` prop and no Files pill.

- [ ] **Step 7: Add the scope row and the three new branches.** In `apps/web/src/features/search/SearchView.tsx`, beside `FILTERS` (`:22-26`) — the two rows are different things and the comment says so:

```tsx
/**
 * What is being searched. A different question from FILTERS below, which are `has:`
 * shortcuts *within* a message search — so they are two rows, not one.
 */
const SCOPES: Array<{ value: SearchScope; label: string }> = [
  { value: 'messages', label: 'Messages' },
  { value: 'files', label: 'Files' },
  { value: 'channels', label: 'Channels' },
  { value: 'people', label: 'People' },
];
```

Signature and state:

```tsx
export function SearchView({
  initialQuery = "",
  initialScope,
}: {
  initialQuery?: string;
  initialScope?: SearchScope;
}) {
  const [scope, setScope] = useState<SearchScope>(initialScope ?? "messages");
  const [fileHits, setFileHits] = useState<FileEntry[] | null>(null);
  const people = useStore((s) => s.users);
  const me = useStore((s) => s.currentUser);
```

The URL effect (`:73-78`) carries the scope:

```tsx
  useEffect(() => {
    const term = query.trim();
    navigate(pathForRoute({ view: "search", query: term || undefined, scope }), {
      replace: true,
    });
  }, [query, scope]);
```

The message effect's guard gains, as its first line inside the timeout:

```tsx
      if (scope !== "messages") {
        setResults(null);
        setTotal(0);
        setNextCursor(null);
        setParsed(null);
        setSearching(false);
        setFailure("none");
        return;
      }
```

with `scope` in the dependency array. Two new effects beside it, in the same
debounce-and-`live` shape:

```tsx
  useEffect(() => {
    const term = query.trim();
    if (scope !== "files" || !term) {
      setFileHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.files.list({ q: term });
        if (live) setFileHits(result.items);
      } catch {
        if (live) setFileHits([]);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, scope]);

  // Channels never leave the client: the store holds exactly the asker's reach.
  const channels = useStore((s) => s.channels);
  const channelHits = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^#/, "");
    if (scope !== "channels" || !term) return null;
    return Object.values(channels).filter(
      (channel) =>
        !channel.archivedAt &&
        [channel.name, channel.topic, channel.description].some((field) =>
          (field ?? "").toLowerCase().includes(term),
        ),
    );
  }, [channels, query, scope]);
```

People need no effect either — the roster is already in the store:

```tsx
  const peopleHits = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/, "");
    if (!term) return [];
    return Object.values(people).filter(
      (person) =>
        !person.deactivated &&
        person.id !== me?.id &&
        person.displayName.toLowerCase().includes(term),
    );
  }, [people, me, query]);
```

Render the scope row above the existing `.chip-row`, and make the filter row and sort group
conditional:

```tsx
        <div className="chip-row" role="group" aria-label="What to search">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              className="chip"
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {scope === "messages" && (
          <div className="chip-row">
            {/* …the existing FILTERS map and .search-sort group, unmoved… */}
          </div>
        )}
```

and in `.search-results`, branch on the scope before the existing message tree, reusing the
directory's classes so no new CSS is needed:

```tsx
        {scope === "files" ? (
          fileHits === null ? (
            <EmptyState mark={<SearchIcon size="xl" />} title="Search files by name">
              Type part of a filename. Only files in conversations you are in are searched.
            </EmptyState>
          ) : fileHits.length === 0 ? (
            <EmptyState title={`No filename matches “${query}”`}>
              Try a shorter fragment — the match is anywhere in the name.
            </EmptyState>
          ) : (
            <ul className="browse-list">
              {fileHits.map((entry) => (
                <li key={entry.id} className="browse-row">
                  <div className="browse-row-main">
                    <div className="browse-row-name">{entry.filename}</div>
                    <div className="browse-row-meta">{entry.createdAt.slice(0, 10)}</div>
                  </div>
                  <button className="btn btn-ghost" onClick={() => void showMessage(entry.messageId)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : scope === "channels" ? (
          /* …the same three-branch shape over channelHits, with
             showChannelFromResult(channel.id, { joined: channel.membership !== null, kind: channel.kind })
             behind an Open button… */
        ) : scope === "people" ? (
          /* …the same shape over peopleHits, with showDirectMessage(person.id)… */
        ) : (
          /* …the existing message tree, unchanged from `failed ? …` down… */
        )}
```

- [ ] **Step 8: Pass the scope in from the shell.** In `apps/web/src/app/Workspace.tsx:491`:

```tsx
      {view === 'search' && (
        <SearchView
          initialQuery={route.view === 'search' ? (route.query ?? '') : ''}
          initialScope={route.view === 'search' ? route.scope : undefined}
        />
      )}
```

- [ ] **Step 9: Run the tests.**

Run: `cd apps/web && pnpm exec vitest run src/features/search/SearchView.test.tsx src/lib/router.test.ts`
Expected: PASS — including the four existing "a search that has been overtaken" cases and the three "parsed query echo" cases, which must not have changed behaviour under the default scope.

- [ ] **Step 10: Gate and commit.**

```bash
pnpm check
torsor guard --strict --severity error $(git ls-files '*.py')
git checkout -- .torsor/map
git add apps/web/src/lib/router.ts apps/web/src/lib/router.test.ts \
        apps/web/src/app/Workspace.tsx \
        apps/web/src/features/search/SearchView.tsx \
        apps/web/src/features/search/SearchView.test.tsx
git commit -m "feat: /search carries the scope it was opened with"
```

---

### Task 4: The records

**Files:**
- Modify: `CLAUDE.md` (the **Client.** paragraph, `:270-275`)
- Modify: `apps/web/src/lib/help.ts:90-101` (the `getting-around` topic) and `:450-463` (the `searching` topic)
- Modify: `apps/web/src/lib/changelog.ts` (`RELEASES[0]` only)
- No new tests; this task runs the whole gate and the browser sweep.

**Interfaces:**
- Consumes: everything Tasks 1–3 shipped. Nothing produces an interface here.

- [ ] **Step 1: One sentence in CLAUDE.md.** There is no existing digest sentence describing what ⌘K searches — the only two mentions are `:309` ("The palette gets no motion at all", still true and unchanged) and `:328` (⌘K as one of Slack's words). Add one clause to the end of the **Client.** paragraph at `:270-275`, written as the invariant rather than as the feature:

> ⌘K fans out to two endpoints (`/api/search`, `/api/attachments`) and the store, with `Tab` narrowing to one, and `/search?scope=` is the same four as a page. Channels and people never leave the client: the store holds exactly the asker's reach (`list_for_user`), so a private channel the asker is not in is never there to show.

- [ ] **Step 2: Fix the help copy that is already wrong.** `apps/web/src/lib/help.ts:96` claims the jump box "matches names, never the words inside messages — searching what people said is the other screen." That has been false since ⌘K gained message search on 2026-09-14. Replace that sentence and add one:

```ts
        body: [
          'The jump box matches channels, people, messages and files at once, in sections, so you can type part of a name or part of something somebody said and press Enter. Tab narrows it to one of those, and the box says which it is looking through.',
          'The arrow shortcuts walk the sidebar in the order it is drawn, wrapping at both ends. The unread ones skip everything you have already read, and pressing again moves to the next one rather than back to the first.',
        ],
```

and widen its keywords at `:100`:

```ts
        keywords: ['keyboard', 'switch', 'jump', 'quick switcher', 'scope', 'files'],
```

- [ ] **Step 3: Say what the search page now does.** In the `searching` topic (`:454-459`), add one line to `body`, after the sentence about what is covered:

```ts
          'The row of buttons above the results chooses what is being searched: Messages, Files, Channels or People. Files match on the name, not on what is inside them, and only files in conversations you are in are listed. A scoped search is in the address, so the link you send opens on the same list.',
```

and widen its keywords at `:462`:

```ts
        keywords: ['search', 'find', 'lookup', 'scope', 'files', 'people', 'channels'],
```

`tests/test_help_parity.py` only parses `commands:` fields, so prose edits cannot break it — but it runs as part of the gate below regardless.

- [ ] **Step 4: One changelog entry.** In `apps/web/src/lib/changelog.ts`, add entries to the **topmost** object in `RELEASES` — do not add a new `{ date, version }` object and do not touch the four `package.json` files. Versions are the controller's call, not this task's.

```ts
      {
        kind: 'added',
        text: 'The jump box (⌘K) now finds four things at once, in sections: channels, people, messages and files. Tab narrows it to one, and “See all” opens the search page already looking through the same thing.',
      },
      {
        kind: 'added',
        text: 'Files can be found by name — type part of a filename in ⌘K or on the search page, and the result opens the message it was posted in.',
      },
```

- [ ] **Step 5: The 400 px sweep.** In a browser, with `pnpm dev` running: open ⌘K at **400 px** and at **1440 px** and check that the scope button and the input share the row without the button pushing the input off the right edge, that the section headers and the "See all" rows do not introduce a horizontal scrollbar, and that a long filename ellipsises (`.palette-item-label` has `min-width: 0`, which is what does that). Then `/search` at both widths with each of the four pills selected, checking the two chip rows wrap rather than overflow. On a coarse pointer (DevTools device emulation), the scope button must be at least 44 px tall and tapping it must advance the scope. Record the result in the commit message.

- [ ] **Step 6: The whole gate.**

```bash
pnpm check
cd apps/api && uv run alembic check
cd - && torsor guard --strict --severity error $(git ls-files '*.py')
```

Expected: green, `alembic check` quiet, guard silent. `pnpm check` does **not** run `alembic check` or `torsor guard`, which is why both are here.

- [ ] **Step 7: Commit.**

```bash
git checkout -- .torsor/map
git add CLAUDE.md apps/web/src/lib/help.ts apps/web/src/lib/changelog.ts
git commit -m "docs: record the search scopes in the digest, the guide and the changelog"
```
