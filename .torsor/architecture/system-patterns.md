---
type: system-patterns
status: active
tags: [architecture]
---

# System Patterns

## Architecture overview

```
routers/     HTTP surface. Authorize, call a service, emit after commit.
services/    Business logic. Take a session, return data.
realtime/    Hub, WebSocket, presence. Imports nothing from routers/.
plugins/     Manifest, registry, signing, outbox, delivery. Imports nothing from routers/.
jobs/        arq worker entrypoints.
lib/         auth, errors, ids, queue, rate limits, storage, mail, net.
db/          engine, models, Alembic migrations.
```

Two layering rules are enforced by `torsor guard` rather than remembered:

- **`realtime/` imports nothing from `routers/`**, so the socket tier can move to its own
  process without a rewrite when connection counts justify it.
- **`plugins/` imports nothing from `routers/`**. Routers depend on the plugin layer, not
  the other way round.

Services may expose an event-shaping helper — `read_state.broadcast()` is one — but the
caller invokes it from an after-commit callback. The invariant is not "services never
touch the hub"; it is **nothing emits inside a transaction**.

## The shape of every write

```python
async with transaction() as (session, after):
    await assert_channel_access(session, user.id, channel_id, require_member=True)
    result = await service.do_the_thing(session, ...)
    await plugin_events.emit(session, ...)      # outbox row, same transaction
    after.add(lambda: hub.to_channel(channel_id, event))   # runs past COMMIT
```

`transaction()` yields an `AfterCommit` collector and drains it after the commit, which
makes persist-then-broadcast structural rather than remembered. Emitting mid-transaction
is the classic bug where a client fetches a message the database has not committed.

## Conventions

- **Errors** come from `apps/api/src/blob_api/lib/errors.py` and carry a stable `code`.
  The envelope `{error: {code, message, field?}}` is part of the client contract — do not
  rename codes.
- **Authorization is one function.** `assert_channel_access` is the only channel check,
  used identically for people and for bots. There is no second path to keep in step.
- **Private things 404.** Non-membership of a private channel reports "does not exist",
  because its existence is private.
- **Tests are named as sentences** describing the property, not the method under test:
  `test_an_app_cannot_reach_a_private_channel_it_was_not_invited_to`.
- **Comments explain why, never what.** The codebase is commented at the level of
  decisions and traps, not narration.

## The hidden dependency

`apps/api/src/blob_api/db/models.py` and `apps/api/tests/conftest.py` have changed
together in every commit that touched either, and neither imports the other. **A new
table needs three edits, not one:**

1. the Alembic migration,
2. the model in `models.py` — or `alembic check` starts proposing to drop the table, which
   is how the `themes` gap went unnoticed for two milestones,
3. the `TRUNCATE` list in `conftest.py` — or state leaks between test modules and the
   failures appear somewhere unrelated.

## Patterns in use

- **Transactional outbox** for plugin delivery — the row and the thing it describes
  commit together. See [[0006-transactional-outbox-for-plugin-delivery]].
- **Keyset pagination only**, never OFFSET. `(channel_id, id DESC)` covers history,
  forward-fill and jump-to-message.
- **Monotonic read cursors** with `GREATEST(...)`, never `COUNT(*)`.
- **Idempotent insert** via `ON CONFLICT (channel_id, author_id, client_msg_id) DO
  NOTHING RETURNING id`, then re-select on no row. 201 first, 200 on retry.
- **Bounded outbox per socket** — the hub's `send()` is `put_nowait` onto a bounded
  queue with a writer task; a full queue closes the connection rather than growing
  without limit.
- **Lease, don't lock, across I/O.** The plugin drain stamps `next_attempt_at` and
  commits before the HTTP call, so a slow third party cannot hold a transaction open.
- **Data, not code, for user-supplied config.** Themes are token allowlist + colour
  grammar; blocks are a discriminated union. Neither is ever CSS or HTML text.
