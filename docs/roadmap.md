# Blob — Staged Improvement Roadmap

## Context

This roadmap comes from a fresh deep dive: two read-only codebase audits (chat-experience parity, and robustness/performance/ops), 2026 competitive web research, and three planning lenses (trust-first, product parity, differentiators) merged into one sequence. It supersedes the earlier admin-console plan, whose work has shipped.

The through-line finding: **the backend is consistently one to two steps ahead of the UI.** Many Slack-parity features are fully built server-side with zero client callers (`/api/threads`, `PATCH /membership`, custom emoji, `?around=`, pins, channel member ops, `also_in_channel`). The cheapest wins are wiring up what's already paid for. The audits also surfaced several correctness/security holes that must close before multi-tenancy multiplies the blast radius.

Committed order is preserved: **Janus one-click → design rebuild → multi-tenancy phase 1.** Hardening is folded into R1/R2 because the SSRF fix guards Janus's own fetch path, and the hub test harness must exist before the `to_all → to_workspace` rewrite.

Effort key: **S** ≤1 day · **M** 1–4 days · **L** >1 week.

---

## R1 — Trust Patch + Janus Ship (days)
**Goal:** close the exploitable holes and the two silent-death bugs, prove the deploy artifact, ship Janus one-click.

- [ ] Janus one-click install remainder (branch near done) — `plugins/runner.py`, `plugins/source.py` — **S**
- [ ] Inert SSRF guards: `check_outbound_url` return value discarded at `runner.py:96` + `source.py:71`; add a raising `assert_outbound_url` wrapper in `lib/net.py` + tests — **S** (same PR as Janus: it guards Janus's fetch path)
- [ ] Unfurl redirect SSRF: `follow_redirects=False`, manual ≤3-hop walk re-checking `is_private_host` per hop — `jobs/unfurl.py:60-70` — **S**
- [ ] Translate endpoint: add `consume()` rate limit; move DeepL call outside the transaction — `routers/messages.py:168-213` — **S**
- [ ] `remove_reaction` access oracle: add `assert_channel_access` (private-404 charter) — `routers/messages.py:358-367` — **S**
- [ ] Zombie socket on outbox overflow: `closed_event` on Connection, writer exits on close, ws endpoint tears down on FIRST_COMPLETED; first hub backpressure test — `realtime/hub.py:54-64`, `realtime/ws.py:78-83` — **S**
- [ ] Redis pub/sub bridge supervision (backoff + resubscribe + loud logging) — `hub.py:219-233` — **S**
- [x] ~~CI job that builds and boots the Docker image~~ — **already existed.** CI's `image` job builds, boots `docker-compose.prod.yml --wait`, checks `/healthz` + `/readyz`, and asserts the schema reached head. The audit called this the largest unverified deploy risk on the strength of a stale note in `.torsor/active/context.md`, now corrected.

**Done when:** fixes merged with regression tests, Docker image green in CI, Janus installs one-click on Coolify.

## R2 — Hardening Batch + Member Quick Wins + Serbian Search (~2 wk)
**Goal:** finish the trust arc, fix daily-pain items that survive the rebuild untouched, make search work in Serbian.

**Backend hardening**
- [ ] notify job: `webpush(timeout=10)`, split transaction so fanout runs outside it (worker `max_jobs=8`); first `handle_notify` test — `jobs/notify.py:43/125/141` — **M**
- [ ] arq worker: `job_timeout`, `max_tries=3`, failure logging hook — `jobs/worker.py:90-102` — **S**
- [ ] Security headers middleware (CSP, nosniff, frame-ancestors) + magic-number upload validation + attachment disposition for non-allowlisted types; first files-router tests — `main.py`, `routers/files.py` — **S+M**
- [ ] Kill the tsvector-over-the-wire: explicit column list on message reads — `services/serialize.py:243` — **S**
- [ ] Serbian search (one migration to the middle rung): `'simple'` config + IMMUTABLE `blob_unaccent` wrapper + regenerated column/GIN + `pg_trgm` fallback + trailing-token prefix; query side `services/search.py:92,105` — **M**
- [ ] Structured logging + request-id middleware (born-instrumented before the new backends) — `main.py`, new `lib/logging.py` — **S**
- [ ] Retention sweeps: sessions, password_resets, deliveries, audit crons — `jobs/` — **M**
- [ ] `.env.example` reconciliation (incl. VAPID) + backup/restore doc — **S**
- [ ] M1 settings-become-real (schema slice): typed settings table + readers (feature toggles, agents kill switch, signup mode, retention days, upload limits, banner) — **S–M**

**Member quick wins** (row/composer-level; none touch the shell, so nothing is rebuilt twice)
- [ ] Composer draft: `key={channelId}` at `ChannelView.tsx:176` + drafts slice mirrored to localStorage; same for thread composer — **S**
- [ ] MessageRow memo fix: hoist inline `onOpenThread` at `ChannelView.tsx:141` — **S**
- [ ] Thread-typing bleed: key typing by `(channelId, threadRootId)` — `store.ts`, `socket.ts`, protocol — **S**
- [ ] Also-send-to-channel checkbox (`outbox.ts:64` hardcodes false; server ready) — **S**
- [ ] Per-channel mute/notify/star via existing PATCH membership; sidebar kebab + starred sort — `Sidebar.tsx`, `api.ts:267` — **S**
- [ ] Title + favicon badge counts (create a favicon at all; respects mutes; prereq for R7 PWA) — new `lib/badge.ts` — **S**
- [ ] Image lazy-load + width/height at upload (kills layout shift; feeds R6 Files) — attachments, BlockRenderer — **S–M**
- [ ] Cache-Control on file 302s + stable presign window (ends per-visit re-download) — `routers/files.py`, `lib/storage.py` — **S**
- [ ] Pinned bar (shallow: click scrolls if loaded; R5 upgrades to jump) — `ChannelView.tsx` — **S**

**Done when:** search finds "čćšžđ" and Serbian homographs; drafts survive reload and channel switches; images cache across visits; sweep/rate-limit/notify/files tests in the suite.

## R3 — Rebuild I: Shell Swap + Threads + Browse (~1.5 wk)
**Goal:** the one-time shell restructure; every zero-caller nav endpoint gets its UI.

- [ ] Top-bar tabs Messages/Activity/Files/Channels replacing the icon rail; centred search; huddle button ships **disabled**; member invite affordance — `TopBar.tsx`, delete `Rail.tsx`, `Workspace.tsx` — **M**
- [ ] Sidebar gains Threads/Mentions/Saved (Threads real now; Mentions R4; Saved R6) — `Sidebar.tsx` — **S**
- [ ] Threads view on existing `GET /api/threads`; first fix the 2N correlated subqueries + add `last_reply_at` index — **S+S**
- [ ] Browse Channels screen (list/join endpoints exist) — **S**
- [ ] `/c/{id}` and `/c/{id}/{messageId}` routes (kills the dead push deep-link; feeds R5 permalinks, R7 push) — `lib/router.ts` — **S**
- [ ] Sync completeness: replay edits/deletes/reactions offline; fix resync discarding readStates + replacing channels map; convergence + >200-backlog tests — `routers/sync`, `store.ts` — **M**
- [ ] First `store.ts` test batch: insert/ordering, unread string-compare, resync merge — **M**

**Done when:** new shell on main, Threads and Browse live, disconnect-edit-reconnect converges, store tests in CI.

## R4 — Rebuild II: Activity Backend + Agent Governance (~2 wk, two tracks)
**Goal:** first new backend (Activity) plus the governance half that makes agent hosting feel safe.

- [ ] `activity_events` table (UUIDv7, workspace+user scoped **in the MT-phase-1 shape from day one**), populated at existing notify/mention persist points; keyset-paginated `routers/activity.py`; row shape generic for reminders + future AI recap — **M**
- [ ] Activity tab UI + sidebar Mentions (same endpoint, filtered) — **M**
- [ ] M2 trust half: agents directory, deliveries console + replay, circuit breaker, kill-switch UI reading R2's typed settings — admin console — **M**
- [ ] Unread "New" divider scroll-to on open (uses `?around=` anchored at first-unread; R5 generalizes it) — **M**

**Done when:** mention/reaction/reply events land in Activity in real time; an agent can be killed, replayed, and circuit-broken from the console.

## R5 — Rebuild III: Message-Surface Parity (~2 wk)
**Goal:** everything on the message row and composer, batched once.

- [ ] Real emoji picker (unicode, search, skin tones) + `:autocomplete:` + custom emoji from bootstrap + M5 emoji CRUD admin slice — **M**
- [ ] Reaction hover bar (blocked by picker); reserve the Saved bookmark slot for R6 — **S**
- [ ] Formatting toolbar B/i/S/link/list/code (renderer already supports it) — `Composer.tsx` — **S**
- [ ] Generalize the `?around=` anchored loader → permalinks/copy-link, search-result jump, pin-click jump (one mechanism, four features) — `MessageList`, `api.ts:281-284` — **M**
- [ ] Search UX honest pass: `from:`/`in:` alone, parsed-query echo, honest totals, keyset pagination, hit highlighting — `routers/search.py`, `SearchView` — **M**
- [ ] Display stored statuses on rows/hovers — **S**
- [ ] `markdown.tsx` XSS golden tests + `socket.ts` reconnect tests — **S–M**

**Done when:** any message is linkable and jumpable; reactions/formatting match the design; XSS goldens green.

## R6 — Rebuild IV: People + Files (~2 wk, second new backend)
**Goal:** channel header becomes real; Files tab on a thumbnail pipeline, never full-res.

- [ ] Channel header: members list/add/leave/topic-edit (all four endpoints exist, zero callers); Members button gets an onClick; invite completion — **M**
- [ ] Profile cards on existing `GET /api/users/{id}`; group DM creation on existing multi-user `POST /api/dms` — **S+S**
- [ ] Thumbnailer: Pillow arq job populating the existing `thumb_key` + history backfill; **strictly blocks the Files tab** — **M**
- [ ] Files tab: keyset-paginated per-workspace/channel listing, filters, grid + lightbox — **M**
- [ ] `saved_items` table + Saved view + bookmark action on the hover bar — **S–M**
- [ ] Image-group grid rendering (stack → grid) — **S**

**Done when:** design rebuild scope closed (minus huddles); a 50-photo channel loads thumbnails, not 200MB.

## R7 — Reach: PWA, Mobile, i18n + Fillers (~2–3 wk)
**Goal:** Blob works on a phone in Serbian with working notifications — the MT-readiness release.

- [ ] PWA + web push end-to-end: `public/` dir, manifest, icons, service worker, pushManager opt-in, iOS install prompt; deep-links via R3 routes; push respects R2 mutes — **M–L**
- [ ] Mobile chat layout (breakpoints + drawer, pattern proven in admin; done now so the *new* shell goes responsive) — **L**
- [ ] i18n extraction, Serbian locale first (after rebuild copy settles) — new `lib/i18n` — **M**
- [ ] Scheduled send + reminders (arq deferred jobs; reminders write into R4 activity feed; system "Blob" bot user) — **S–M each**
- [ ] Presence idle detection + `mark_away` caller; self-hosted fonts; sourcemap privacy; `--forwarded-allow-ips` tightening; session-resolve round-trip reduction; sync N+1 + cursor-in-URL fix — **S each**
- [ ] E2E suite completion (Playwright vs the R1 image): login→send→receive→reload, thread, search, upload — **M**

**Done when:** installed-PWA push opens the right channel on a phone, UI in Serbian, E2E green in CI.

## R8 — Multi-Tenancy Phase 1 + AI Track (2–3 months, phased)
**Goal:** the committed cross-tenant fixes, with small parallel backend tracks.

- [ ] `assert_channel_access` workspace check (~30 call sites) — **L**
- [ ] Invite workspace match; login disambiguation; `hub.to_all → to_workspace` (on R1's hub harness); member-injection composite FKs — **L**
- [ ] M4 people/security depth in parallel (admin session list, force password reset, auth audit) — **M**
- [ ] M6 hosted AI provider: workspace-scoped `ai_settings`, OpenAI-compat client (hard timeout, rate limit, no transaction across the LLM call); first consumer swaps heuristic thread summaries (provider column + endpoints + broadcast already exist, zero API change); seed `embed()` stub only — **S–M**
- [ ] AI catch-up/recap: `POST /api/channels/{id}/recap`, boundary = `read_states.last_read_message_id`, arq job, per-user private storage, `hub.to_user` only; "Catch up" button on the unread divider + R4's reserved Activity card; daily digest DM as v1.1 — **M**

**Done when:** two workspaces on one instance cannot see each other's anything (cross-tenant E2E proves it); recap works against a self-hosted or hosted provider.

---

## Explicitly rejected / deferred

- **Canvas** — a second product; off-charter for a solo maintainer.
- **Workflow builder** — agents *are* the workflow story; Janus-style one-click recipes deliver the value at a tenth the cost.
- **Per-language search column** — superseded by R2's `simple`+unaccent+trgm rung.
- **Semantic / ask-AI search** — real ops burden (pgvector, embedding pipeline); R2 FTS fix removes today's pain. Only the `embed()` stub is seeded in R8.
- **Huddles (LiveKit)** — deferred past R8, funded whole or not at all: L effort, breaks the 3-runtime-dep rule, real risk is UDP/TURN infra. Spike deploy docs + a bare test page before any Blob code. Button ships disabled in R3.
- **M2 policy gates + approval queue, M3 analytics, M5 moderation queue, M7/M8 export + Slack import, M9 OIDC, M10 user groups** — post-R8 horizon, roughly that order; none blocks anything above.

## Must precede multi-tenancy phase 1

1. `remove_reaction` oracle fixed + all intra-workspace access-check gaps closed (R1).
2. Both SSRF fixes (R1) — untrusted tenants turn "any member" into "anyone who signs up."
3. Translate rate limit (R1) — shared paid budget becomes cross-tenant denial-of-wallet.
4. Zombie-socket + bridge fixes **with the hub backpressure test harness** (R1) — safety net for the `to_all → to_workspace` rewrite.
5. Structured logging + request IDs (R2) — "which tenant saw whose data" must be answerable.
6. Docker build in CI (R1) + full E2E smoke (R7).
7. `store.ts` resync/merge tests (R3) — the client brain pinned before workspace-scoped fan-out changes what it receives.
8. All new tables (activity_events, saved_items, ai_settings, scheduled_messages) born workspace-scoped in the phase-1 shape.

## Verification

The existing gate (tsc + ruff + mypy --strict + full pytest, 322 passing) stays the merge bar; each release ships its own test surfaces *with* the fix: R1 adds SSRF/rate-limit/oracle regressions + the first hub-backpressure and notify-job tests; R2 adds files-router (polyglot upload), sweep, and Serbian-search tests; R3 pays the `store.ts` debt and adds sync-convergence + >200-backlog tests; R5 adds markdown XSS goldens and socket reconnect; R7 completes Playwright E2E against the R1 image (one spec per release from R2 on). R8 starts only when the eight preconditions are green, and its first commit is a cross-tenant E2E spec (two workspaces, mutual 404s) that stays red until phase 1 completes.
