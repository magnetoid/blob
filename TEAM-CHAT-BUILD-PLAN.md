# Team Chat Build Plan

**A comprehensive research-backed plan for building a self-hosted, Slack-class team chat app for internal company use.**

- Working name: **Blob** (after the repo — rename freely)
- Audience: one company, **< 100 users**, self-hosted
- Platforms: **web-first**; desktop/mobile wrappers in later phases
- Stack: **TypeScript end-to-end** — React + Vite, Fastify, WebSockets, Postgres 16, Redis, MinIO, Docker Compose
- Date of research: August 2026. All findings below cite primary sources.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Research digest: market, trends, and what users actually want](#2-research-digest)
3. [Product spec: MVP / V1 / V2](#3-product-spec)
4. [UX/UI spec and design system](#4-uxui-spec-and-design-system)
5. [Architecture](#5-architecture)
6. [Detailed build instructions (9 milestones)](#6-detailed-build-instructions)
7. [Deployment & operations](#7-deployment--operations)
8. [Scaling ladder & future phases](#8-scaling-ladder--future-phases)
9. [Appendix: the buy/fork alternative](#9-appendix-the-buyfork-alternative)
10. [Sources](#10-sources)

---

## 1. Executive summary

We are building an internal, self-hosted team chat application with the core of what makes Slack powerful — channels, DMs, threads, reactions, mentions, search, file sharing, unread tracking, presence — while deliberately fixing the top two complaints users have about every incumbent: **notification fatigue** and **unreliable search**, and avoiding the single most resented commercial practice: **message-history caps**.

Deep research into how Slack, Discord, and Zulip are engineered (§2, §5) produced a short list of architectural decisions that are nearly free to adopt on day one but prohibitively expensive to retrofit later — time-sortable message IDs, idempotent client message IDs, persist-then-broadcast event flow, cursor-based read state, view-scoped presence. This plan bakes all of them in, so the app runs comfortably on a single VM for 100 users today and has a documented, trigger-based scaling ladder (§8) if it ever needs to serve thousands.

**Headline decisions** (rationale throughout the document):

| Decision | Choice |
|---|---|
| Threading | Slack-style side-panel threads (`thread_root_id`), chosen for zero adoption friction internally |
| Transport | REST for writes, WebSocket for delivery (Zulip's split); reconnect = REST resync |
| Database | Postgres 16 only — messages, search (FTS), everything; Redis for ephemera |
| IDs | UUIDv7 (time-sortable) primary keys; keyset pagination only |
| Auth | Email + password + invite links; session cookies (httpOnly); OIDC SSO in V1 |
| Files | MinIO (S3 API) with presigned uploads; thumbnails in a worker |
| Read receipts | **No.** Typing indicators yes. (Deliberate, evidence-based — §4.5) |
| Deployment | One `docker-compose.yml`: Caddy, app, worker, Postgres, Redis, MinIO |

---

## 2. Research digest

Condensed from three deep research passes (market/trends, features/UX, architecture). Sources inline; consolidated list in §10.

### 2.1 Market landscape, 2025–2026

- **Microsoft Teams** leads on volume (last official figure: 320M MAU, Oct 2023 — [office365itpros](https://office365itpros.com/2023/10/26/teams-number-of-users-320-million/)); its moat is bundling inside Microsoft 365, now legally constrained in the EU (binding unbundling commitments accepted Sept 2025 — [Loyens & Loeff](https://www.loyensloeff.com/insights/news--events/news/microsofts-commitments-on-its-teams-platform-accepted-by-european-commission/)).
- **Slack** under Salesforce reached ~$3B revenue in FY2026 with ~1M businesses ([TechCrunch](https://techcrunch.com/2026/03/31/salesforce-announces-an-ai-heavy-makeover-for-slack-with-30-new-features/)). Pricing: Pro $7.25, Business+ $15/user/mo ([slack.com/pricing](https://slack.com/pricing)); the free tier caps history at 90 days.
- **Open-source/self-hosted**: Mattermost (AGPLv3, pivoted to defense/sovereignty), Rocket.Chat (MIT core + proprietary enterprise), Zulip (Apache-2.0, now nonprofit-governed by the Zulip Foundation — [blog.zulip.com](https://blog.zulip.com/2026/05/15/announcing-zulip-foundation/)), Element/Matrix (AGPLv3, the European public-sector sovereignty winner), and 37signals' **Campfire** — $299 one-time, single Docker image, deliberately minimal ([once.com/campfire](https://once.com/campfire)). Campfire is proof that a credible internal chat tool's true core is about a dozen features.

### 2.2 Trends that matter for this build

1. **AI moved from paid add-on to table stakes.** Slack killed its $10/seat AI add-on and folded AI into base plans; Google bundled Gemini into all Workspace tiers ([Slack help](https://slack.com/help/articles/39264531104275-Updates-to-feature-availability-and-pricing-for-Slack-plans), [Appxite](https://www.appxite.com/blog/google-includes-gemini-ai-into-workspace-with-new-pricing-model)). The 2026 frontier is chat as the *human–AI-agent interface* (Slackbot as MCP client; Microsoft Agent 365). **Implication:** design the bot/webhook API so an AI agent can later be a first-class member (V2, §3.4) — but ship none of it in MVP.
2. **Data ownership is the wedge.** Slack's May 2025 API terms banned bulk export and LLM training on your own data, throttling non-marketplace apps to 1 request/minute ([Computerworld](https://www.computerworld.com/article/4005509/salesforce-changes-slack-api-terms-to-block-bulk-data-access-for-llms.html)). Hack Club's public $195k/yr Slack repricing (3,400+ HN points) ended in a migration to Mattermost ([mahadk.com](https://mahadk.com/posts/slack)). **Implication:** self-hosting an internal tool is precisely the right call; keep the data model export-friendly (plain Postgres, plain S3 objects).
3. **Sovereignty/self-hosting is a durable wave**, especially in Europe (EU Parliament resolution 471–68, Jan 2026; Schleswig-Holstein, Bundeswehr/openDesk — [Irish Times](https://www.irishtimes.com/world/europe/2026/02/14/a-small-german-states-quiet-revolt-against-microsoft-and-what-it-means-for-europe/)).
4. **E2EE (MLS, RFC 9420) is maturing** but Slack-likes deliberately skip it because it kills server-side search, compliance export, and bots — the features organizations actually want internally ([RFC 9420](https://datatracker.ietf.org/doc/rfc9420/)). We follow suit: TLS in transit, encryption at rest, no E2EE (explicit non-goal, §3.5).

### 2.3 What users love and hate (review mining)

| App | Loved | Hated |
|---|---|---|
| Slack | Integrations, emoji culture, huddles, search modifiers | **Notification fatigue (#1)**, threads UX, unreliable search of old messages, price, RAM usage ([Capterra](https://www.capterra.com/p/135003/Slack/reviews/), [G2](https://www.g2.com/products/slack/reviews?qs=pros-and-cons)) |
| Teams | M365 integration, meetings | UX ("the Achilles heel"), slowness, bloat ([MS Q&A](https://learn.microsoft.com/en-us/answers/questions/4438885/is-there-a-way-to-fix-the-very-bad-ui-ux-we-have-t)) |
| Zulip | Topic threading, Inbox triage, keyboard-first | Learning curve, less polish |
| Discord | Free voice, forums, no read receipts, themes | Redesign churn without opt-out, auto-archiving threads |

**The two design implications this plan acts on:** (a) invest disproportionately in the **notification/unread model** — per-channel overrides, keyword alerts, DND schedule, a clean Activity view (V1); (b) make **search reliable over the full history** from day one — full-text search across everything, permission-filtered, with Slack-style modifiers.

### 2.4 The threading decision

The three models compared ([zulip.com/why-zulip](https://zulip.com/why-zulip/), [Discord forum FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ), HN threads [1](https://news.ycombinator.com/item?id=25270399), [2](https://news.ycombinator.com/item?id=23844273)):

- **Slack threads** — reply chains in a side panel. Optional and retroactive; familiar to everyone; weakest discoverability.
- **Zulip topics** — every message addressed to `(channel, topic)`. Best async catch-up in the industry; real onboarding friction.
- **Discord threads/forums** — separates ephemeral threads from durable forum posts; clever but two object types to build.

**Chosen: Slack-style threads.** For an internal tool under 100 users, zero-friction familiarity beats structural elegance — everyone already knows how Slack threads work, and the failure mode Zulip fixes (losing conversations in 10,000-member channels) barely occurs at this scale. We mitigate the known weaknesses: thread replies surface in the (V1) Activity view, threads you participated in get a dedicated "Threads" item in the sidebar (MVP), and roots show reply count + participant avatars + last-reply time inline in the channel. The schema (`thread_root_id`, §5.3) also leaves room for V2 forum-style views if ever wanted.

### 2.5 Engineering lessons from the incumbents

Full detail in §5; the headlines that shaped this architecture:

- **Slack**: separate stateful real-time tier from the web app; presence went from broadcast to *view-scoped subscriptions* — a 5× reduction in presence traffic ([slack.engineering/real-time-messaging](https://slack.engineering/real-time-messaging/), [presence_sub changelog](https://api.slack.com/changelog/2017-06-batch-presence-and-presence-subscriptions)). Their costliest mistake: sharding by workspace, fixed by a 3-year Vitess migration re-sharding on `channel_id` ([slack.engineering/vitess](https://slack.engineering/scaling-datastores-at-slack-with-vitess/)).
- **Discord**: read state is its own scaling problem — one `(user, channel)` row with counters, LRU-cached, write-coalesced ([discord.com/blog/go-to-rust](https://discord.com/blog/why-discord-is-switching-from-go-to-rust)); messages keyed by `(channel_id, time bucket)` with time-sortable Snowflake IDs ([trillions of messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)).
- **Zulip**: the cleanest readable reference. Writes go through the web app; events are emitted **after the DB transaction commits**; clients reconcile on reconnect ([events system docs](https://zulip.readthedocs.io/en/latest/subsystems/events-system.html)). Its load profile — 44% of requests are event polls served in 1–3ms with zero DB access — shows why the delivery path must be cheap.
- **Scale reality check**: Mattermost documents 200,000-user deployments on plain Postgres ([docs.mattermost.com](https://docs.mattermost.com/deployment-guide/reference-architecture/application-architecture.html)). Single-node Postgres is genuinely sufficient into tens of millions of messages. At <100 users we are 3+ orders of magnitude below any interesting limit — the plan's job is to keep the scaling rungs *reachable*, not to climb them now.

---

## 3. Product spec

### 3.1 Users and jobs

Employees of one company (< 100 people), on desktop browsers primarily, who need to: follow team channels without drowning; have quick DMs and group conversations; keep decisions findable months later; share files/screenshots; know who's around. Admins (IT) need to: invite/deactivate users, manage channels, back up data, and operate the system with minimal ceremony.

### 3.2 MVP — the messaging core (Milestones M0–M9, §6)

**Structure**
- One workspace. Public channels, private channels, DMs, group DMs (nameable).
- Channel create/rename/archive (archive = read-only, still searchable); channel topic + description; default channels auto-joined on signup (`#general`, `#random`).
- Sidebar with sections: Threads, unread-first channel list, DMs; manual favorites ("Starred") section.

**Messages**
- Markdown subset (CommonMark-based, *not* Slack's mrkdwn): bold/italic/strike, inline code, fenced code blocks with syntax highlighting, blockquote, lists, links. Live preview shorthand in the composer; Shift+Enter = newline; Enter = send (configurable).
- Edit (with `(edited)` marker), delete (soft), copy link, quote-reply.
- Paste/drag image or file to upload; multiple attachments per message; image previews inline; link unfurls (title/description/image) via worker.
- Emoji reactions (Unicode + **custom emoji upload** — cheap and culture-forming); reaction picker with search and frequently-used.
- Mentions: `@user`, `@channel`, `@here`; autocomplete popup; mentioned names highlighted; mentions drive badge counts.
- Slack-style threads per §2.4: reply in thread, optional "also send to channel", thread roots show reply count/participants/last activity, "Threads" sidebar view listing threads you started or replied to, unread state per thread.
- Typing indicators (5s TTL). **No read receipts** (§4.5).
- Message grouping: consecutive messages from one author within 60s cluster under one avatar/timestamp; hover shows exact time; relative date separators.

**Attention & notifications** (the #1 thing to get right)
- Unread bold + badge distinction: bold = any unread; numeric badge = mentions/DMs only.
- Per-channel notification setting: everything / mentions only / mute.
- Global keyword alerts (e.g. your project's name).
- DND: manual snooze + recurring notification schedule (work hours); no pings outside it.
- Browser notifications via the Notifications API when the app is open; **Web Push (VAPID)** when it's closed; badge count in tab title/favicon.
- Mark channel read, "mark all read"; jump-to-last-read line ("New messages" divider).

**Finding things**
- **Cmd/Ctrl+K quick switcher** — channels, people, and actions in one palette (research is unequivocal: this is MVP, not polish — [Slack shortcuts](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)).
- Full-text search over all messages and file names, permission-filtered, with modifiers `from:`, `in:`, `before:`, `after:`, `has:link`, `has:file`, `is:thread` ([Slack search grammar](https://slack.com/help/articles/202528808-Search-in-Slack)). **No history cap, ever.**
- Pinned messages per channel.

**People**
- Presence dot (active/idle/away) — view-scoped subscriptions (§5.6); custom status (emoji + text + expiry); profile card (name, title, timezone, local time).

**Platform basics**
- Email+password auth, invite links, password reset via email; session management ("log out other devices"); admin role (invite/deactivate users, delete any message, manage channels/emoji); workspace settings page.
- Light + dark theme; compact/comfortable density toggle; keyboard navigation and accessibility per §4.7.
- **Incoming webhooks** (post a message to a channel via URL+token) — trivial to build, disproportionately useful internally (CI, alerts, cron reports).

### 3.3 V1 — becomes the company's daily driver

- **Activity view**: one filterable inbox of mentions, thread replies, and reactions (Slack's Activity — the honest fix for notification fatigue; [Slack Activity view](https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack)).
- Saved items ("Later" private queue), bookmarks bar per channel (three distinct affordances, per research — pins are shared/channel, bookmarks are shared links, saved is private).
- Message reminders ("remind me in 1h"), scheduled send, drafts view.
- **Huddles**: audio-first calls in a channel/DM with screen share, via **self-hosted LiveKit** (Apache-2.0 SFU; ~200+ participants on 4vCPU/16GB — [LiveKit](https://livekit.io); [SFU comparison](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion)). Don't build an SFU.
- **OIDC SSO** (generic — works with Google Workspace, Entra, Okta) + optional 2FA for password accounts; SCIM only if ever needed.
- Bot/API platform v1: bot users with tokens, outgoing webhooks (event subscriptions), slash commands.
- Email notifications digest for offline users (mentions/DMs you didn't see), deduped against push.
- Sidebar custom sections; channel naming-convention prefixes (`#help-`, `#proj-`) suggested at creation.
- Import tool: Slack export ZIP → channels/users/messages/files.

### 3.4 V2 — differentiation & platform

- Reaction-triggered automation (reacji routing: react with 🎫 → copies to `#tickets`; the highest-ROI automation primitive per line of code).
- Lightweight workflow builder (trigger → form → post), canvas-lite (a pinned collaborative doc tab per channel).
- AI layer (self-hosted or API): thread/channel summaries ("catch me up"), semantic search over history, huddle notes. Admin toggle for AI features (trust pattern from Slack's playbook).
- **Agent-native**: MCP support so AI agents can join channels as governed members with their own identity and permissions — the 2026 direction of the whole category.
- Desktop wrapper (**Tauri v2**: ~12MB vs Electron's ~180MB — [comparison](https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026)); mobile app (**React Native + Expo**, sharing types/API client with web).
- Guest accounts (single-channel), retention policies, audit log, compliance export — only if compliance ever demands them.

### 3.5 Explicit non-goals

No billing/multi-tenant SaaS. No federation (Matrix). No E2EE (kills search/bots/admin — §2.2). No app marketplace. No message-history caps or artificial limits — these exist to monetize, and we have nothing to monetize. No read receipts (§4.5). Voice/video is *not* in MVP (LiveKit in V1 keeps that honest).

---

## 4. UX/UI spec and design system

### 4.1 Layout anatomy

Four zones, left to right (the post-2024 canonical layout, minus Slack's mistakes):

```
┌────┬───────────────┬──────────────────────────────┬───────────────┐
│Rail│   Sidebar     │       Message pane           │  Right panel  │
│ 56 │    260px      │        flexible              │  380px (opt)  │
│    │               │                              │               │
│Home│ Workspace ▾   │  #engineering        ☆ 👥 12 │  Thread       │
│Act.│ ── Threads    │  ──────────────────────────  │  ───────────  │
│DMs │ ── Starred    │  [day divider: Today]        │  root msg     │
│    │ # general     │  avatar Name 10:42           │  replies…     │
│ ⚙  │ # engineering │    message text              │               │
│ 👤 │ # random      │    └ 3 replies · 2 people    │  [composer]   │
│    │ + Add channel │  [── New messages ──]        │               │
│    │ ── DMs        │  avatar Name 10:55           │               │
│    │ ● Ana         │                              │               │
│    │ ○ Marko       │  [composer ......... ⏎]      │               │
└────┴───────────────┴──────────────────────────────┴───────────────┘
```

- **Rail is collapsible from day one** — the loudest complaint about Slack's 2023 redesign was the rail consuming space for light users ([Fast Company](https://www.fastcompany.com/90972862/four-ways-the-confusing-slack-redesign-is-making-it-hard-to-work-today)). In MVP the rail can even be omitted (Home/DMs merged in the sidebar) and introduced in V1 with the Activity view; keep the CSS grid ready for it.
- Right panel hosts: thread view, channel details/members, profile card, pinned messages. One panel, swappable content, closable (Esc).
- Ship UI changes behind user-level toggles when redesigning later — Discord's 2025–26 redesign backlash was about *removal of choice*, not the designs ([gamerant](https://gamerant.com/discord-ui-changes-users-unhappy/)).

### 4.2 Design tokens

Aesthetic direction: quiet, dense-but-breathing productivity surface in the post-2024 idiom — hairline borders instead of shadows, a surface ladder instead of elevation, one restrained accent ([Linear design analysis](https://blog.logrocket.com/ux-design/linear-design/)). Not a Linear clone: our neutrals bias warm-green toward the accent, and the accent itself is a viridian, not the ubiquitous periwinkle.

```css
:root {
  /* light theme (default) */
  --bg:        #FAFBFA;   /* app canvas */
  --surface:   #FFFFFF;   /* panes, cards */
  --surface-2: #F1F4F2;   /* hover, sidebar */
  --hairline:  #E2E7E4;
  --text:      #1B211E;
  --text-2:    #5C665F;   /* secondary */
  --text-3:    #8B948E;   /* timestamps, meta */
  --accent:    #22826B;   /* viridian — links, active channel, focus */
  --accent-hover: #2C9B80;
  --mention:   #B4540A;   /* mention highlight — warm, distinct from accent */
  --danger:    #C2453A;
  --unread-dot:#22826B;
}
:root[data-theme="dark"] {
  --bg:        #0E1210;
  --surface:   #151A17;
  --surface-2: #1B211D;
  --hairline:  #262E29;
  --text:      #E8ECE9;
  --text-2:    #9AA69E;
  --text-3:    #6C7670;
  --accent:    #3FB394;
  --accent-hover: #55C7A8;
  --mention:   #E08A3C;
  --danger:    #E06055;
  --unread-dot:#3FB394;
}
```

- **Type**: system UI stack for the interface (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) — the professional choice for a chat app (native feel, zero font-loading jank; Campfire does the same). `JetBrains Mono` (self-hosted) for code blocks. Scale: 13 (meta) / 15 (body) / 15 semibold (names) / 18 (pane titles) / 22 (settings headings). Message body line-height 1.45.
- **Spacing**: 4px base scale — 4/8/12/16/24/32/48. **Radii**: 4 (inputs), 6 (buttons, message hover), 8 (cards, popovers), 12 (modals).
- **Depth**: hairlines + surface ladder; shadows only on floating elements (popovers/modals), and subtle.
- **Density toggle**: comfortable (15px body, 8px message padding) vs compact (14px, 4px) — ship both, don't pick for users.
- Both themes are first-class: every component styled via tokens only; never a hex in a component.

### 4.3 Message rendering rules

- Cluster consecutive messages from the same author within 60s: avatar + name + time on the first, subsequent messages hanging-indented; per-message time on hover in the left gutter.
- Date separators: sticky, relative ("Today", "Yesterday", then "Aug 14").
- Hover toolbar on message (right-aligned, appears on hover/focus): react (top 3 frequent + picker), reply in thread, share, more (edit/delete/copy link/pin/remind).
- Thread roots in channel show a reply summary line: facepile (≤3 avatars) + "4 replies" + "Last reply 2h ago" — clickable, opens right panel.
- Unread line: hairline in `--mention` color with "New" label; scroll position restores to it on channel open.
- `(edited)` in `--text-3` after body; deleted messages render as a tombstone ("This message was deleted") only when they have thread replies, else disappear.
- Images: max 360px tall inline, click for lightbox; multiple images form a 2-up grid; files render as compact cards (icon, name, size).

### 4.4 Composer

Single-line look that grows to 50vh max; formatting toolbar appears on selection or via "Aa" toggle; markdown shorthand renders live (`*bold*`, backticks). Up-arrow in empty composer edits your last message. Attachments preview above the input before send. `@` triggers mention autocomplete; `:` triggers emoji autocomplete; `/` reserved for V1 slash commands. Drafts persist per-conversation (local + server). Failed sends show retry affordance on the optimistic bubble (§5.5).

### 4.5 Presence, typing, receipts — the social contract

- Typing indicator: "Ana is typing…" in the composer's status line, 5s TTL, max "several people are typing".
- **No read receipts anywhere.** Research is consistent that they raise anxiety and response pressure in workplace chat; Discord's deliberate omission is widely loved ([sceyt.com](https://sceyt.com/blog/must-have-chat-features-for-communication-apps)). Unread state stays private to each user.
- Presence: green dot (active), hollow (away), synced across devices; auto-away after 10 min idle; presence data only pushed for users currently visible on screen (§5.6).

### 4.6 Keyboard & command palette

| Shortcut | Action |
|---|---|
| Cmd/Ctrl+K | Quick switcher: channels, people, actions |
| Alt+↑ / Alt+↓ | Previous / next channel |
| Alt+Shift+↑/↓ | Previous / next **unread** channel |
| Esc | Mark channel read; close panel |
| Shift+Esc | Mark all read |
| Cmd/Ctrl+F | Search in current channel |
| Cmd/Ctrl+Shift+\ | React to last message |
| ↑ (empty composer) | Edit last message |

The palette (Cmd+K) is a single input matching channels (`#`), people (`@`), and verbs ("mute channel", "set status", "toggle theme") with fuzzy matching — the highest-leverage navigation primitive in the category.

### 4.7 Accessibility & i18n

- F6 cycles regions (rail → sidebar → messages → composer → panel); Tab moves within a region ([Slack's model](https://slack.com/intl/en-gb/help/articles/4455747966739-Accessibility-in-Slack)).
- Message list is `role="log"` with `aria-live="polite"` for new messages; every interactive element keyboard-reachable with visible focus ring (2px `--accent` at 50%).
- WCAG AA contrast in both themes (the token palette above passes; verify at build with axe).
- `prefers-reduced-motion` honored: no scroll animations, no reaction pop effects.
- i18n scaffolding from day one (all strings through a t() layer, ICU plurals) even if English-only at launch; UTF-8 everywhere; timestamps localized; RTL layout is a stretch goal Slack still hasn't shipped ([Slack language prefs](https://slack.com/help/articles/215058658-Manage-your-language-preferences)).

---

## 5. Architecture

### 5.1 System shape

```
                    ┌─────────────────────────────────────────┐
  Browser (React) ──┤ Caddy (TLS, static assets, reverse proxy)│
                    └───────┬──────────────────────┬──────────┘
                        HTTPS│                  WSS│
                    ┌────────▼──────────────────────▼──────────┐
                    │  Fastify app (Node 22, TypeScript)       │
                    │  ├── /api/*      REST: all writes+reads  │
                    │  └── /ws         WebSocket: delivery only│
                    └──┬────────────┬─────────────┬────────────┘
                       │            │             │
                ┌──────▼───┐  ┌─────▼────┐  ┌─────▼─────┐
                │Postgres16│  │  Redis   │  │  MinIO    │
                │ messages │  │ presence │  │  files    │
                │ FTS index│  │ typing   │  │ thumbs    │
                └──────────┘  │ pub/sub  │  └───────────┘
                              │ BullMQ   │
                              └─────▲────┘
                                    │
                            ┌───────┴────────┐
                            │ Worker process │  push, email, unfurls,
                            │ (BullMQ)       │  thumbnails, digests
                            └────────────────┘
```

**The one structural rule:** writes go through REST and persist to Postgres; the WebSocket tier only *delivers* events, never owns truth. This is Zulip's split ([events system](https://zulip.readthedocs.io/en/latest/subsystems/events-system.html)) and it means a WebSocket outage degrades to "no live updates", never to data loss, and the client can always resync over REST.

At <100 users the app and worker run as two containers on one VM. The WebSocket handler lives in its own module (`src/realtime/`) with no imports from HTTP route handlers, so it can be split into its own process later without a rewrite (§8).

### 5.2 Conventions

- **IDs**: UUIDv7 everywhere (`uuidv7` npm package or Postgres 18's native `uuidv7()`; on PG16 generate in app). Time-sortable, so `ORDER BY id` = chronological, and "is there anything unread?" is `last_message_id > last_read_message_id` — a comparison, not a `COUNT(*)`. Random UUIDv4 PKs cause up to 10× more index page splits at scale ([authgear](https://www.authgear.com/post/time-sortable-identifiers-uuidv7-ulid-snowflake/)).
- **Pagination**: keyset only — `WHERE channel_id=$1 AND id < $cursor ORDER BY id DESC LIMIT 50`. Never `OFFSET`.
- **Timestamps**: `timestamptz`, UTC, ISO-8601 on the wire.
- **Soft deletes**: `deleted_at` on messages; hard-delete only via admin purge.
- **Everything scoped by `workspace_id`** even though there's one workspace — a single column now avoids a migration if a second workspace ever appears.

### 5.3 Schema (Postgres 16)

```sql
-- ─── identity ────────────────────────────────────────────────────────────
CREATE TABLE workspaces (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  email           citext NOT NULL,
  password_hash   text,                       -- null once SSO-only
  display_name    text NOT NULL,
  full_name       text,
  title           text,
  avatar_key      text,                       -- MinIO object key
  timezone        text NOT NULL DEFAULT 'UTC',
  role            text NOT NULL DEFAULT 'member'   -- member | admin | owner
                  CHECK (role IN ('member','admin','owner')),
  status_emoji    text,
  status_text     text,
  status_expires_at timestamptz,
  prefs           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- theme, density, keywords, dnd
  deactivated_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,          -- sha256 of opaque cookie token
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX ON sessions (user_id);

CREATE TABLE invites (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email        citext,                        -- null = open link
  token_hash   text NOT NULL UNIQUE,
  created_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id)
);

-- ─── channels ────────────────────────────────────────────────────────────
CREATE TABLE channels (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  kind          text NOT NULL CHECK (kind IN ('public','private','dm','group_dm')),
  name          text,                         -- null for dm
  topic         text,
  description   text,
  created_by    uuid REFERENCES users(id),
  archived_at   timestamptz,
  last_message_id uuid,                       -- denormalized for cheap unread checks
  dm_key        text,                         -- sorted member-id hash; unique per dm
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX channels_name_uniq ON channels (workspace_id, lower(name))
  WHERE kind IN ('public','private');
CREATE UNIQUE INDEX channels_dm_uniq ON channels (workspace_id, dm_key)
  WHERE dm_key IS NOT NULL;

CREATE TABLE channel_members (
  channel_id   uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  notify_level text NOT NULL DEFAULT 'mentions'   -- all | mentions | none
               CHECK (notify_level IN ('all','mentions','none')),
  is_starred   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX ON channel_members (user_id);

-- ─── messages ────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id             uuid PRIMARY KEY,            -- UUIDv7: chronological
  workspace_id   uuid NOT NULL REFERENCES workspaces(id),
  channel_id     uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES users(id),   -- null for system messages
  kind           text NOT NULL DEFAULT 'user' -- user | system | bot
                 CHECK (kind IN ('user','system','bot')),
  body           text NOT NULL DEFAULT '',    -- raw markdown source
  thread_root_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  also_in_channel boolean NOT NULL DEFAULT false,  -- "also send to channel"
  reply_count    integer NOT NULL DEFAULT 0,       -- denormalized on root
  reply_user_ids uuid[] NOT NULL DEFAULT '{}',     -- facepile, capped at 5
  last_reply_at  timestamptz,
  mention_user_ids uuid[] NOT NULL DEFAULT '{}',   -- resolved at write time
  mentions_everyone boolean NOT NULL DEFAULT false, -- @channel / @here
  client_msg_id  text NOT NULL,               -- client-generated; idempotency key
  edited_at      timestamptz,
  deleted_at     timestamptz,
  pinned_at      timestamptz,
  pinned_by      uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  search_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);
-- the workhorse index: channel timeline, newest first
CREATE INDEX messages_channel_id_desc ON messages (channel_id, id DESC);
-- thread replies
CREATE INDEX messages_thread ON messages (thread_root_id, id) WHERE thread_root_id IS NOT NULL;
-- idempotent sends: retry of the same client_msg_id is a no-op
CREATE UNIQUE INDEX messages_client_idem ON messages (channel_id, author_id, client_msg_id);
-- search
CREATE INDEX messages_search ON messages USING GIN (search_tsv);
-- mentions lookup for the Activity view
CREATE INDEX messages_mentions ON messages USING GIN (mention_user_ids);
CREATE INDEX messages_pinned ON messages (channel_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;

CREATE TABLE reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,                   -- ':tada:' or ':custom-name:'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, emoji, user_id)
);

CREATE TABLE attachments (
  id          uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  message_id  uuid REFERENCES messages(id) ON DELETE CASCADE,  -- null until send
  uploader_id uuid NOT NULL REFERENCES users(id),
  object_key  text NOT NULL,                  -- MinIO key
  thumb_key   text,
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON attachments (message_id);

CREATE TABLE custom_emoji (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name         text NOT NULL,
  object_key   text NOT NULL,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, name)
);

-- ─── attention state ─────────────────────────────────────────────────────
CREATE TABLE read_states (
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id           uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_message_id uuid,                  -- monotonic; advance only
  mention_count        integer NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE thread_subscriptions (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_root_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  last_read_reply_id uuid,
  muted          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, thread_root_id)
);

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (                        -- incoming webhooks (MVP)
  id          uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  channel_id  uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name        text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
```

**Why these specific choices**

- `client_msg_id` + unique index is the single highest-value line in the schema: retries after a dropped connection are no-ops that return the original row, which makes optimistic UI, offline queues, and at-least-once delivery all safe at once.
- `mention_user_ids` resolved and stored at write time turns the Activity view and badge math into an index lookup rather than a text scan.
- `reply_count` / `reply_user_ids` / `last_reply_at` denormalized on the root render the channel's thread summary line without a second query per message.
- `channels.last_message_id` makes "does this channel have unreads?" a single comparison against `read_states.last_read_message_id`.

### 5.4 Realtime protocol

WebSocket at `/ws`, authenticated by the session cookie at handshake (upgrade rejected with 401 otherwise). JSON frames, `{t: string, ...}`.

**Server → client events**

| `t` | Payload | Notes |
|---|---|---|
| `hello` | `{user_id, server_time, session_seq}` | after auth |
| `message.new` | full message object + author stub | to channel members only |
| `message.updated` | `{id, channel_id, body, edited_at}` | |
| `message.deleted` | `{id, channel_id, thread_root_id?}` | |
| `reaction.added` / `reaction.removed` | `{message_id, channel_id, emoji, user_id}` | |
| `thread.updated` | `{root_id, channel_id, reply_count, reply_user_ids, last_reply_at}` | keeps summary line live |
| `channel.created` / `.updated` / `.archived` | channel object | |
| `member.joined` / `.left` | `{channel_id, user_id}` | |
| `typing` | `{channel_id, user_id, thread_root_id?}` | ephemeral, no persistence |
| `presence` | `{user_id, state}` | only for subscribed users |
| `user.updated` | user object | status/profile changes |
| `read_state.updated` | `{channel_id, last_read_message_id, mention_count}` | multi-device sync |

**Client → server frames**

| `t` | Purpose |
|---|---|
| `ping` | 25s heartbeat; server replies `pong` |
| `presence.sub` | `{user_ids: []}` — replaces the subscription set for this connection (Slack's `presence_sub`; 5× traffic reduction) |
| `typing` | `{channel_id, thread_root_id?}` — rate-limited to 1/3s |
| `channel.focus` | `{channel_id}` — server tracks the active view for push suppression |

**Everything else is REST.** Sending a message is `POST /api/channels/:id/messages`, not a WebSocket frame — so it gets normal HTTP semantics, retries, status codes, and works when the socket is down.

**Reconnect & delta replay.** Client tracks `last_message_id` per open channel. On reconnect: `hello` → client calls `GET /api/sync?channels=a,b,c&since=<per-channel cursors>` → server returns messages created since, plus changed read states and channel list version. If the gap exceeds 200 messages per channel, the server responds `{resync: true}` and the client refetches that channel's tail. This is Zulip's `last_event_id` model generalized ([events system](https://zulip.readthedocs.io/en/latest/subsystems/events-system.html)).

**Fan-out.** One process at this scale: an in-memory `Map<channel_id, Set<connection>>` plus `Map<user_id, Set<connection>>`. Every emit also publishes to Redis pub/sub on `ws:events` and each process re-broadcasts to its local connections — so a second app container works from day one with no code change. Presence and typing never touch Postgres.

**Persist-then-broadcast, after commit.** Route handlers do all DB work in a transaction, and the emit happens in the `.then()` after `COMMIT` — never inside it. Emitting inside a transaction is the classic bug where a client fetches a message the database hasn't committed yet (Zulip's `send_event_on_commit` exists for exactly this).

### 5.5 The send path, end to end

1. Client generates `client_msg_id` (UUIDv7), renders an optimistic bubble immediately, `POST /api/channels/:id/messages {body, client_msg_id, thread_root_id?, attachment_ids?}`.
2. Server: authorize membership → parse markdown for mentions → resolve `mention_user_ids` → `INSERT ... ON CONFLICT (channel_id, author_id, client_msg_id) DO NOTHING RETURNING *`; if no row returned, `SELECT` the existing one (idempotent retry) → update `channels.last_message_id` → if reply, update root's `reply_count`/`reply_user_ids`/`last_reply_at` → advance the author's own `read_states` → COMMIT.
3. After commit: broadcast `message.new` to channel members; enqueue BullMQ jobs (`notify`, `unfurl`).
4. Client receives its own `message.new`, matches by `client_msg_id`, replaces the optimistic bubble with the authoritative row (correct `id`, `created_at`). Non-matching events append normally.
5. On network failure the client retries the same POST with the same `client_msg_id` — step 2 makes that safe. After 3 failures the bubble shows "Not sent — retry".

### 5.6 Unread, mentions, notifications

**Unread algebra** (no `COUNT(*)` anywhere in the hot path):
- Channel has unreads ⟺ `channels.last_message_id > read_states.last_read_message_id` (UUIDv7 comparison = chronological comparison).
- Badge number = `read_states.mention_count`, incremented in the notify worker when a message mentions the user (or is a DM), reset to 0 when the channel is marked read.
- Marking read: `UPDATE read_states SET last_read_message_id = GREATEST(last_read_message_id, $1), mention_count = 0` — monotonic, so out-of-order acks from two devices can't rewind.
- The initial channel list query returns per-channel `{has_unread, mention_count}` in one round trip (join `channel_members` × `channels` × `read_states`).

**Notification decision tree** (in the `notify` worker, per recipient):
```
is author?                     → skip
channel muted?                 → skip
DND active for user?           → skip (except… nothing. DND means DND)
message mentions user
  or is DM
  or matches user's keywords
  or channel notify_level=all  → deliver
otherwise                      → skip
```
Delivery: if the user has a live WebSocket **and** their focused channel is this channel → in-app only. If connected but focused elsewhere → in-app + optional sound. If disconnected → Web Push after a 45s debounce (they may return); daily email digest for anything still unseen after 30 min (V1).

**Presence & typing** live only in Redis: `presence:{user_id} = state` with a 60s TTL refreshed by heartbeat; `typing:{channel_id}:{user_id}` with a 5s TTL. Clients declare which users they can see via `presence.sub` and receive updates for those only.

### 5.7 Search

Postgres FTS behind a `SearchService` interface (one file to swap for Meilisearch if it's ever needed — it won't be at this scale; [Supabase's comparison](https://supabase.com/blog/postgres-full-text-search-vs-the-rest)).

```sql
SELECT m.* FROM messages m
JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $me
WHERE m.workspace_id = $ws
  AND m.deleted_at IS NULL
  AND m.search_tsv @@ websearch_to_tsquery('english', $q)
  AND ($from::uuid IS NULL OR m.author_id = $from)
  AND ($chan::uuid IS NULL OR m.channel_id = $chan)
  AND ($before::timestamptz IS NULL OR m.created_at < $before)
ORDER BY ts_rank(m.search_tsv, websearch_to_tsquery('english', $q)) DESC, m.id DESC
LIMIT 30;
```

**The join against `channel_members` is the security boundary** — it is what stops private-channel content leaking into search. It is not optional and must be covered by a test.

Modifier parsing (`from:@ana in:#eng has:link before:2026-01-01`) happens client-side into structured params; free text is the remainder.

### 5.8 Files

Presigned PUT direct to MinIO: `POST /api/uploads` returns `{attachment_id, url, fields}`; the browser uploads directly (server never proxies bytes); the attachment row is created up-front with `message_id = NULL` and bound to the message on send. Orphans (no message after 24h) are swept by a nightly job. Server chooses object keys (`{workspace}/{yyyy}/{mm}/{uuid}/{filename}`), 15-minute expiry, exact method+content-type signed. Downloads go through presigned GETs generated per request — bucket stays private. The thumbnail worker generates a 480px WebP for images and strips EXIF ([AWS presigned URL guidance](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)).

### 5.9 Auth & security

- **Opaque session tokens in httpOnly, SameSite=Lax, Secure cookies**, sha256-hashed in `sessions`. Chosen over JWTs because instant revocation matters more than statelessness for a chat app (log out a stolen laptop *now*).
- Passwords: **argon2id** (`@node-rs/argon2`), min 10 chars, checked against a breached-password list at signup.
- Rate limits (Redis token bucket): login 10/15min/IP, message send 30/min/user, upload 20/min/user, search 30/min/user, webhook 60/min/token.
- CSRF: SameSite=Lax + `Origin` header check on all mutating routes.
- Uploads: content-type sniffing, extension allowlist, `Content-Disposition: attachment` for anything non-image, no SVG rendering inline.
- Markdown → HTML sanitized server-side allowlist (no raw HTML, no `javascript:` URLs); render on the client from the sanitized AST.
- Every route authorizes via a single `assertChannelAccess(userId, channelId)` helper — one code path, one test surface.

---

## 6. Detailed build instructions

Repository layout (pnpm workspaces monorepo):

```
blob/
├─ apps/
│  ├─ server/          Fastify API + WebSocket + worker entrypoints
│  │  ├─ src/
│  │  │  ├─ index.ts            HTTP server bootstrap
│  │  │  ├─ worker.ts           BullMQ worker bootstrap
│  │  │  ├─ db/                 pool, migrations, query helpers
│  │  │  ├─ routes/             auth, channels, messages, search, uploads, admin
│  │  │  ├─ realtime/           ws server, hub, presence, typing
│  │  │  ├─ services/           message, channel, read-state, search, notify
│  │  │  ├─ jobs/               notify, unfurl, thumbnail, digest, sweep
│  │  │  └─ lib/                auth, markdown, ids, errors, rate-limit
│  │  └─ test/
│  └─ web/             React + Vite SPA
│     └─ src/
│        ├─ app/                routing, providers, layout shell
│        ├─ features/           channels, messages, threads, search, presence…
│        ├─ components/         design-system primitives
│        ├─ lib/                api client, ws client, store, markdown
│        └─ styles/             tokens.css, base.css
├─ packages/
│  └─ shared/          TS types + zod schemas shared by server and web
├─ docker-compose.yml
├─ Caddyfile
└─ .env.example
```

Testing throughout: **Vitest** for units and API integration (real Postgres via a test database, truncated per test), **Playwright** for the handful of end-to-end flows that matter (send/receive across two browser contexts, unread badge, search). Write the test first for anything with logic — the unread math, mention parsing, idempotent send, and permission checks especially.

### M0 — Scaffold
Monorepo, TypeScript strict, ESLint+Prettier, Fastify with health check, Vite React app, shared package, docker-compose with Postgres/Redis/MinIO, migration runner, CI script (`pnpm check` = typecheck + lint + test).
**Done when:** `docker compose up` gives a running app at localhost:3000 that renders "hello" and passes `/healthz` against a real DB.

### M1 — Identity
Migrations for workspaces/users/sessions/invites. Signup (first user becomes owner and creates the workspace), login, logout, session middleware, invite links, password reset by email (Nodemailer → MailHog in dev), profile editing, avatar upload, admin user list with deactivate.
**Done when:** an invited user can accept, set a password, log in, see their profile, and an admin can deactivate them (sessions revoked immediately). Tests cover argon2 hashing, session expiry, invite single-use.

### M2 — Channels, DMs, and live messages
Channels/channel_members/messages tables. Create/join/leave/archive channels; DM and group-DM creation (`dm_key` dedupe); channel list API with membership; message send (full §5.5 path), history with keyset pagination, infinite scroll up; WebSocket server with cookie auth, hub, per-channel subscription, Redis pub/sub bridge; optimistic send with reconciliation; reconnect with `/api/sync`.
**Done when:** two browsers, two users, one channel — a message sent in A appears in B in under 200ms; killing the socket and restoring it replays the gap; sending the same `client_msg_id` twice creates one row.

### M3 — Conversation depth
Threads (`thread_root_id`, reply summary line, right-panel thread view, "also send to channel", Threads sidebar view, `thread_subscriptions`); edit/delete with events; reactions with picker and aggregation; mention parsing/autocomplete/highlighting; message hover toolbar; pins; markdown rendering with code highlighting; message grouping rules.
**Done when:** a thread with 5 replies renders correctly in channel and panel, reactions update live for all viewers, `@name` notifies exactly the named user, and editing a message updates every open client.

### M4 — Attention
`read_states`, unread computation, "New messages" divider, mark-read on view/Esc, badge counts, per-channel notify levels, keyword alerts, DND schedule, notify worker with the §5.6 decision tree, browser Notification API, Web Push (VAPID) with service worker, tab-title badge.
**Done when:** unread bold and mention badges are correct across two devices for the same user, a mention delivers a push while the app is closed, and a muted channel delivers nothing.

### M5 — Files
`attachments`, presigned upload flow, drag/drop and paste, upload progress, inline image rendering and lightbox, file cards, thumbnail worker, orphan sweeper, avatar/custom-emoji pipelines, link unfurl worker.
**Done when:** a 5MB screenshot pasted into the composer uploads directly to MinIO, renders as a thumbnail, opens full-size, and survives a server restart.

### M6 — Search
FTS index, `SearchService`, modifier parsing, search UI with result grouping and jump-to-message (loads surrounding context), in-channel search, permission-filter test.
**Done when:** searching a term in a private channel you're not in returns nothing (test), searching one you are in jumps you to that message in context.

### M7 — Polish & people
Cmd+K command palette, presence with view-scoped subscriptions, custom status with expiry, typing indicators, profile cards, custom emoji management, channel details panel, keyboard shortcuts, drafts, empty states, `/shrug`-tier client commands.
**Done when:** every §4.6 shortcut works, presence updates only for visible users (verify traffic in devtools), and Cmd+K reaches any channel or person in ≤3 keystrokes.

### M8 — Themes, density, accessibility
Token system, light/dark/system themes, density toggle, focus rings, F6 region cycling, `role="log"` live region, axe-clean pass, `prefers-reduced-motion`, i18n scaffolding.
**Done when:** axe reports zero violations on the main view in both themes, and the app is fully operable without a mouse.

### M9 — Ship it
Production Dockerfiles (multi-stage), Caddy config with automatic TLS, backup script + restore rehearsal, structured logging, `/metrics`, error tracking, admin settings page, incoming webhooks, seed/demo data, README + runbook.
**Done when:** a fresh VM goes from `git clone` to a working HTTPS deployment with one command, and a restore-from-backup drill succeeds.

---

## 7. Deployment & operations

**Target**: one VM, 4 vCPU / 8 GB RAM / 100 GB SSD (generous for 100 users — Mattermost documents 2 vCPU/4GB for 1,000). Ubuntu LTS + Docker.

**`docker-compose.yml` services**

| Service | Image | Notes |
|---|---|---|
| `caddy` | caddy:2 | TLS via Let's Encrypt, serves web build, proxies `/api` + `/ws` |
| `app` | built | Fastify; `NODE_ENV=production`; healthcheck `/healthz` |
| `worker` | built (same image, `worker.ts`) | BullMQ consumers |
| `postgres` | postgres:16 | volume `pgdata`, `shared_buffers=2GB` |
| `redis` | redis:7 | `appendonly yes`, volume |
| `minio` | minio/minio | volume, private bucket `blob-files` |

**Caddyfile** (the whole TLS story):
```
chat.example.com {
  handle /api/* { reverse_proxy app:3000 }
  handle /ws    { reverse_proxy app:3000 }
  handle        { root * /srv/web; try_files {path} /index.html; file_server }
}
```

**Secrets**: `.env` on the host (mode 600), never in git; `.env.example` documents every key. Required: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `S3_*`, `SMTP_*`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `PUBLIC_URL`.

**Backups** (the only operational task that genuinely matters):
- Nightly `pg_dump -Fc` to a second volume, then off-box (rclone to whatever storage the company already has). Keep 30 dailies + 6 monthlies.
- MinIO data mirrored nightly (`mc mirror`).
- **Rehearse the restore quarterly.** A backup you haven't restored isn't a backup.
- Enable WAL archiving only if the acceptable data-loss window drops below 24h.

**Operations**: healthchecks on every container with `restart: unless-stopped`; structured JSON logs to stdout → Docker's json-file driver with rotation (or Loki if the company runs it); `/metrics` in Prometheus format (connections, messages/min, job queue depth, p99 query time). Upgrades: `git pull && docker compose build && docker compose up -d` — migrations run automatically at boot, forward-only, additive first (add column → deploy → backfill → drop old later) so a rollback never loses data.

---

## 8. Scaling ladder & future phases

Each rung is triggered by an **observed metric**, never by anticipation. At <100 users you are on rung 0 and will very likely stay there for years.

| Trigger | Response |
|---|---|
| Baseline (<1,000 concurrent) | Single app container. Nothing to do. |
| App CPU > 60% sustained | Run 2–3 app containers behind Caddy; the Redis pub/sub bridge already makes this work unchanged. |
| >10k concurrent sockets | Split `src/realtime/` into its own process/container (it has no HTTP-route imports, by design). |
| >50k concurrent, reconnect storms hurt | Channel-affinity: consistent-hash channels to realtime nodes so each subscribes only to its channels — Slack's Channel Server in miniature ([slack.engineering](https://slack.engineering/real-time-messaging/)). |
| Boot payload > 1s for the workspace | Read-through cache of users/channels/members with lazy client hydration — a Flannel-equivalent ([slack.engineering/flannel](https://slack.engineering/flannel-an-application-level-edge-cache-to-make-slack-scale/)). |
| Fan-out cost dominates | Suppress delivery to passive sessions (Discord's ~90% fanout reduction — [maxjourney](https://discord.com/blog/maxjourney-pushing-discords-limits-with-a-million-plus-online-users-in-a-single-server)). |
| Postgres write contention | Partition `messages` by time; move read-state to a write-coalescing service; add a read replica. |
| Search relevance complaints | Swap `SearchService` for Meilisearch/Typesense — one file. |
| Only after all of the above | Citus/Vitess-style sharding on `channel_id`. |

**Feature phases** follow §3.3 and §3.4: V1 (Activity view, saved/reminders/scheduled send, huddles via LiveKit, OIDC SSO, bot API, Slack importer), then V2 (reacji automation, AI summaries/semantic search, MCP agents, Tauri desktop, Expo mobile).

---

## 9. Appendix: the buy/fork alternative

Honest framing: for **under 100 internal users**, deploying an existing open-source app is the lower-risk path, and this document should say so plainly.

| Option | Effort | Trade-off |
|---|---|---|
| **Mattermost** self-hosted | ~1 day | Go binary + Postgres, proven to 200k users, closest Slack parity. Team Edition has no SSO and is AGPLv3; enterprise features are paid. |
| **Zulip** self-hosted | ~1 day | Apache-2.0 (friendliest license), unlimited users free, best-in-class threading — but the topic model is a real behavior change for the team. |
| **Rocket.Chat** | ~1 day | MIT core, heaviest resource footprint. |
| **Campfire (ONCE)** | ~1 hour | $299 one-time, single container, deliberately minimal — no threads, no search depth. |
| **Build (this plan)** | ~3–5 months part-time to MVP | Exactly the product you want, full data ownership, a real codebase to extend, and no license or vendor constraints. Costs are yours: every feature, every bug, forever. |

Build if the point is the capability, the control, or the craft — and this plan is written for that path. If the point is simply "we need chat by next month", deploy Zulip or Mattermost this week and revisit.

---

## 10. Sources

**Engineering**
Slack real-time messaging · <https://slack.engineering/real-time-messaging/> ·
Flannel edge cache · <https://slack.engineering/flannel-an-application-level-edge-cache-to-make-slack-scale/> ·
Vitess migration · <https://slack.engineering/scaling-datastores-at-slack-with-vitess/> ·
Job queue · <https://slack.engineering/scaling-slacks-job-queue/> ·
Discord: trillions of messages · <https://discord.com/blog/how-discord-stores-trillions-of-messages> ·
Discord: Go→Rust read states · <https://discord.com/blog/why-discord-is-switching-from-go-to-rust> ·
Discord: million-user guild · <https://discord.com/blog/maxjourney-pushing-discords-limits-with-a-million-plus-online-users-in-a-single-server> ·
Discord: Elixir at 5M · <https://discord.com/blog/how-discord-scaled-elixir-to-5-000-000-concurrent-users> ·
Zulip events system · <https://zulip.readthedocs.io/en/latest/subsystems/events-system.html> ·
Zulip performance · <https://zulip.readthedocs.io/en/latest/subsystems/performance.html> ·
Mattermost architecture · <https://docs.mattermost.com/deployment-guide/reference-architecture/application-architecture.html> ·
Phoenix 2M sockets · <https://www.phoenixframework.org/blog/the-road-to-2-million-websocket-connections> ·
Time-sortable IDs · <https://www.authgear.com/post/time-sortable-identifiers-uuidv7-ulid-snowflake/> ·
Postgres FTS vs the rest · <https://supabase.com/blog/postgres-full-text-search-vs-the-rest> ·
Presigned URL practices · <https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf> ·
SFU comparison · <https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion> ·
Tauri vs Electron · <https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026>

**Product, market & UX**
Slack pricing · <https://slack.com/pricing> ·
Slack plan/AI pricing changes · <https://slack.com/help/articles/39264531104275-Updates-to-feature-availability-and-pricing-for-Slack-plans> ·
Slack search · <https://slack.com/help/articles/202528808-Search-in-Slack> ·
Slack shortcuts · <https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts> ·
Slack accessibility · <https://slack.com/intl/en-gb/help/articles/4455747966739-Accessibility-in-Slack> ·
Slack Activity view · <https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack> ·
Slack API lockdown · <https://www.computerworld.com/article/4005509/salesforce-changes-slack-api-terms-to-block-bulk-data-access-for-llms.html> ·
Slack 30 AI features · <https://techcrunch.com/2026/03/31/salesforce-announces-an-ai-heavy-makeover-for-slack-with-30-new-features/> ·
Teams unbundling (EU) · <https://www.loyensloeff.com/insights/news--events/news/microsofts-commitments-on-its-teams-platform-accepted-by-european-commission/> ·
Zulip: why topics · <https://zulip.com/why-zulip/> ·
Zulip Foundation · <https://blog.zulip.com/2026/05/15/announcing-zulip-foundation/> ·
Discord forum channels · <https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ> ·
Campfire (ONCE) · <https://once.com/campfire> ·
Hack Club's Slack repricing · <https://mahadk.com/posts/slack> ·
Slack threads criticism (HN) · <https://news.ycombinator.com/item?id=25270399> ·
Slack reviews · <https://www.capterra.com/p/135003/Slack/reviews/> ·
Teams UX complaints · <https://learn.microsoft.com/en-us/answers/questions/4438885/is-there-a-way-to-fix-the-very-bad-ui-ux-we-have-t> ·
Slack redesign backlash · <https://www.fastcompany.com/90972862/four-ways-the-confusing-slack-redesign-is-making-it-hard-to-work-today> ·
Discord redesign backlash · <https://gamerant.com/discord-ui-changes-users-unhappy/> ·
Linear design language · <https://blog.logrocket.com/ux-design/linear-design/> ·
MLS RFC 9420 · <https://datatracker.ietf.org/doc/rfc9420/> ·
EU sovereignty shift · <https://www.irishtimes.com/world/europe/2026/02/14/a-small-german-states-quiet-revolt-against-microsoft-and-what-it-means-for-europe/>

