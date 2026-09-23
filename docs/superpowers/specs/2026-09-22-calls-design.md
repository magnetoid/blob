# Calls: video meetups, finished, and huddles

**Status:** design, 2026-09-22. Asked for by Marko: settings in the server admin page for
"video meetups", another page for "audio room", and both built as features — on open-source
software where that is appropriate. Two answers shaped it: an audio room is a **huddle in a
channel** (Slack's model — not standing Discord-style rooms, not a Spaces-style stage), and a
huddle does **voice, camera and screen**, so a video meetup is the full-screen form of the same
call. He also asked for "lots of micro-animations in the interface": the call UI is designed
with them (see Motion); the rest of the app gets its own pass
(`2026-09-22-micro-animations-design.md`). Architectural; two PRs.

## What exists today (verified 2026-09-22, not quoted)

| Piece | Where | State |
|---|---|---|
| Row | `db/migrations/versions/0035_meetups.py`, `db/models.py` `Meetup` | `meetups(id, workspace_id, channel_id NULL, created_by, name, status active\|ended, created_at, ended_at)` |
| Service | `services/meetups.py` (129 lines, `text()`) | create, get, end, `generate_token` (identity = user id, room = meetup id, publish/subscribe/data, default TTL) |
| Router | `routers/meetups.py` (81 lines) | `POST /api/meetups`, `GET/POST …/{id}`, `/token`, `/end`; channel access via `assert_channel_access(require_member=True)` |
| Tests | `tests/test_meetups.py` | 6 tests: `/api` prefix, 404 for outsiders, owner may end, `livekit_not_configured` |
| Client start | `features/messages/ChannelView.tsx:176-199` | "Meetup in #x", or navigate to the one in `activeMeetups` |
| Client view | `features/meetups/MeetupView.tsx` (67 lines) | mints a token, `<LiveKitRoom><VideoConference/></LiveKitRoom>`, `onDisconnected → navigate('/')` |
| Route | `lib/router.ts:87,148` `/meetup/:id`; lazy chunk `app/Workspace.tsx:52` | |
| Live state | `lib/store.ts:1600-1612` | `activeMeetups`, fed **only** by `meetup.started` / `meetup.ended` frames |
| Placeholder | `features/shell/TopBar.tsx` minimal bar; `lib/help.ts:1055` | a disabled "Huddle" — "Huddles arrive in a later release" |
| Stack | `livekit-api` 1.2.1, `@livekit/components-react` 2.9.24, `livekit-client` 2.22.3; `livekit/livekit-server:latest` behind `profiles: ["meetups"]` (`docker-compose.prod.yml:299`); dev compose runs `--dev` | |

### What is broken or missing

1. **A meetup never ends.** The client never calls `/end`, and nothing watches the room: every
   meetup ever started is still `active`.
2. **Join is lost on reload.** `activeMeetups` is filled only by live frames; nothing reads the
   calls in progress, so a reload or a late arrival sees no Join.
3. **Leaving the view hangs up.** The LiveKit connection lives inside the routed view, so
   opening a channel mid-meeting ends your part in it.
4. **No limits and no settings.** Any member can start any number; there is no cap and no admin
   control; `livekit_not_configured` is discovered by clicking.
5. **Two people clicking at once start two rooms.**

## Open source: what I checked (2026-09-22)

LiveKit server **v1.13.7** (2026-09-14) is current; Apache-2.0, Go on Pion; our client
libraries are the latest. The 2026 comparisons recommend it (with Jitsi) for calls built into a
team-chat product ([Fora Soft](https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion),
[WebRTC.ventures](https://webrtc.ventures/2026/06/open-source-webrtc-media-servers/)). Jitsi is a
turnkey app with its own UI and a heavier Java stack (videobridge, Jicofo, Prosody) — a second
media stack beside the one already deployed. mediasoup is an engine to build a server around.
The Janus WebRTC gateway is GPLv3, and its name collides with our agent's.

**Decision: stay on LiveKit, for both kinds; no new service.** It already gives us what the
fixes need: webhooks for who joined and when a room closed, the RoomService API to create rooms
with a cap and to reconcile, and `can_publish_sources` to make the camera and screen settings
part of the token rather than of the UI.

## The model: one call, two kinds

A **call** is a LiveKit room that belongs to one conversation — a channel, DM or group DM.

| | huddle | meetup |
|---|---|---|
| Starts with | microphone on, camera off | camera (per setting) and microphone on |
| Lives in | the call bar; the chat carries on | full screen |
| Cameras and shared screens | the right-hand column (the thread/file slot) | full screen |

Either can switch to the other's presentation. A conversation has at most one live call of each
kind (a partial unique index), and starting one that is live joins it — two people clicking at
once land in the same call. A person is in one call at a time, which is the client's rule:
joining another asks first, then leaves the current one.

## Data — migration 0045

- `ALTER TABLE meetups RENAME TO calls`, with its indexes and constraints renamed
  (`calls_pkey`, `calls_status_check`, `calls_channel`, `calls_workspace_recent`).
- `kind text NOT NULL DEFAULT 'meetup'`, `CHECK (kind IN ('huddle', 'meetup'))`.
- Every row still `active` becomes `ended` (`ended_at = now()`): no LiveKit room behind any of
  them exists any more. This is fix 1 applied to the past.
- `calls_one_live`: `UNIQUE (channel_id, kind) WHERE status = 'active'`.
- `call_participants(call_id → calls ON DELETE CASCADE, user_id → users ON DELETE CASCADE,
  sid text, joined_at timestamptz DEFAULT now(), PRIMARY KEY (call_id, user_id))`. A row exists
  only while that person is connected, and ending the call deletes the call's rows: **Blob keeps
  no attendance history.** `sid` is LiveKit's per-connection id, so a stale "left" arriving after
  a rejoin cannot remove the new connection.
- `channel_id` stays nullable for old rows; the API requires it from now on.

## Server

### `lib/livekit.py` — the only module that talks to LiveKit

`configured()`, `browser_url()`, `ensure_room(name, max_participants)`, `close_room(name)`,
`rooms()`, `participants(name)`, `token(identity, display_name, room, sources)` (TTL ten minutes:
it only has to last until the connect; LiveKit refreshes a connected participant's token itself),
`receive(body, authorization)`. It reaches LiveKit's API at `LIVEKIT_API_URL` when set, else at
`LIVEKIT_URL` (the SDK's twirp client turns `ws` into `http`). Tests swap in a fake through one
fixture. Rooms are created with `departure_timeout` 20 s — a reload does not end a call — and
`empty_timeout` 120 s — a start whose starter never connected closes itself. `CreateRoom` is
idempotent, which is what lets the token route call it again safely.

### `services/calls.py`

- `start(user, channel_id, kind)` — the kind must be on; an existing live call of that kind is
  returned; the unique index settles a race (re-read on violation); `ensure_room` with the kind's
  cap, and if LiveKit does not answer the start fails as `calls_unavailable` (503) with nothing
  written. Persist, then broadcast `call.started`.
- `token(user, call)` — live and on, else refused; grants per kind and settings; `ensure_room`
  again, so a room LiveKit already closed is recreated with the right cap rather than
  auto-created without one.
- `end(user, call)` — the starter or an admin; closes the room, marks it ended, drops its
  participants, broadcasts `call.ended`.
- `active_for(user)` — live calls in conversations the user is a member of, with who is in them.
- `joined` / `left` / `finished` — the webhook's three verbs. `reconcile()` — the sweep.

### Routes — `routers/calls.py` replaces `routers/meetups.py`

| Route | Who | Does |
|---|---|---|
| `GET /api/calls` | member | `{available, settings, calls[]}` — the state the client starts from and resyncs from |
| `POST /api/calls` `{channelId, kind}` | channel member | start or join-existing |
| `POST /api/calls/{id}/token` | channel member | `{token, url}` |
| `POST /api/calls/{id}/end` | starter or admin | end for everyone |
| `POST /api/calls/livekit` | LiveKit | webhook; exact `(method, path)` in `PUBLIC_ROUTES`; a JWT over the body's hash, verified with our key and secret; an unknown or ended room is a 200 that changes nothing |
| `GET/PUT /api/admin/calls` | workspace admin | the settings below |
| `GET /api/admin/calls/server` | instance admin | configured, browser URL, reachable and latency, open rooms, last webhook received |

Every call route passes `assert_channel_access(require_member=True)`, so a private channel's
call answers 404 to an outsider exactly as the channel does. Starting is rate-limited per person.

### Socket frames — both protocol twins, and the parity test

`call.started {call}`, `call.updated {callId, participantIds}`, `call.ended {callId}` to the
channel; `calls.settings {settings}` to the workspace. `meetup.started`/`meetup.ended` retire.
Apps and bots get no call frames — the existing "no presence for apps" rule.

### Settings — `workspace_settings` JSONB, key `calls`, with a typed reader

| Kind | Setting | Default | Range |
|---|---|---|---|
| huddles | enabled | on | |
| huddles | cameras | on | |
| huddles | screenShare | on | |
| huddles | maxParticipants | 50 | 2–100 |
| meetups | enabled | on | |
| meetups | camerasOnJoin | on | |
| meetups | maxParticipants | 50 | 2–100 |

Enforced by the server: a kind that is off cannot be started (403 `huddles_off` / `meetups_off`)
and mints no token (a call in progress keeps the connections it has); a huddle's publish sources
are the microphone plus the camera and the screen only as allowed; a meetup's are all four; the
cap is `max_participants` on the room, which LiveKit enforces itself. `camerasOnJoin` is the
client's default at join. With no LiveKit configured, `available` is false and the client draws
no call buttons at all — the `translationEnabled` pattern.

### The sweep — worker, every minute at :45

For each live call: if its room is gone and the call is more than two minutes old, end it;
otherwise replace its participants with the ones LiveKit reports. This covers a missed webhook,
a server whose LiveKit has no webhook configured (presence then lags by up to a minute rather
than never updating), and a restart.

## Client

### State — main chunk, no LiveKit in it

The store's `activeCalls` replaces `activeMeetups`, and `callSettings` joins it; both are loaded
by `GET /api/calls` at start-up and again in `resync()`, and kept by the four frames.
`lib/calls.ts` holds the session — `{callId, channelId, kind, phase, fullScreen, stageOpen}` —
and `joinCall(channelId, kind)` / `leaveCall()`. The LiveKit `Room` lives in
`features/calls/engine.ts`, imported dynamically on the first join, so the main chunk keeps
**zero** `livekit` references (the W2 ratchet).

### Surfaces

- **Channel header:** a Huddle and a Meetup button. A live one shows up to three avatars and a
  count, and says Join. A kind that is off, or a server without LiveKit, draws no button.
- **Sidebar:** a headphones or camera mark on a conversation with a live call.
- **Call bar** (lazy): at the foot of the channel list; at the foot of the screen at ≤ 768 px;
  compact in the collapsed rail. The conversation's name (a link back to it), avatars with
  speaking rings, then microphone, camera, screen, stage, full screen and leave.
- **Stage:** the right-hand column gains a fourth occupant beside thread, terminal and file —
  camera tiles and a shared screen, the screen in focus. Still one thing at a time.
- **Full screen:** `/call/:id` (`/meetup/:id` still parses) — LiveKit's grid and control bar on
  the *shared* room, so Back returns to the bar instead of hanging up. A cold load of the URL
  shows a Join button first, because browsers only play audio after a gesture.
- **Top bar:** the disabled placeholder goes.

### Admin — a new "Calls" group

**Huddles** (`/admin/huddles`) and **Video meetups** (`/admin/meetups`). Each page opens with a
media-server panel — for the instance admin: configured or not, answering or not and how fast,
the address browsers dial, when LiveKit last reported, how many calls are open; with no LiveKit,
the setup steps — for any other admin, one line. Under it, that kind's settings as the
`AppPolicySection` rows already look: toggles and a number.

## Motion — the call UI's micro-animations

All from the existing tokens, so reduced motion keeps the fades and drops the movement.

| Moment | Motion |
|---|---|
| Call bar appears / goes | rises `--motion-slide-lg` and fades in over `--dur-open`; held through `--dur-exit` by `usePresence` |
| Someone joins | their avatar pops in (`--motion-scale-in` + fade, `--dur-fast`); the count ticks (`key` + `count-tick`) |
| Someone leaves | their avatar fades out, held by presence |
| Someone speaks | a ring fades in on their avatar or tile (`--dur-fast`); your own microphone button carries a three-bar level meter that follows your voice — data, not decoration |
| Microphone / camera / screen toggles | the press gives (`--motion-press`); the icon crossfades between on and off |
| A live call in the header | its avatars stack in; the live dot uses the existing 1.6 s pulse |
| Sidebar mark | fades in with the call and out with it |
| Stage opens / closes | the thread panel's slide in and out |
| A video tile or screen starts | fades in over `--dur-open` when the first frame arrives |
| Connecting | the existing shimmer on the bar |
| Full screen | `overlay-in` |

## Deploy

- **Production compose:** the `livekit` service gains
  `LIVEKIT_CONFIG=webhook: {api_key: …, urls: ["${PUBLIC_URL}/api/calls/livekit"]}` — Blob's
  public address, not a container name: on 2026-09-18 two stacks' same-named services answered
  for each other on a shared network. The app gains an optional `LIVEKIT_API_URL`
  (`http://livekit:7880`), so Blob reaches LiveKit's API on the stack's own network.
- **Dev compose:** the same, to `host.docker.internal:3000`.
- `.env.example` and README "Meetups" become "Calls".
- Turning calls on in production is unchanged: `COMPOSE_PROFILES=meetups`, the three
  `LIVEKIT_*` values, one UDP port per instance.

## Verification

- **pytest:** start is idempotent and survives the race; every route 404s an outsider; a kind
  that is off is refused, and grants follow the camera and screen settings; the webhook — a
  valid signature applies, a bad one is 401, an unknown room is ignored, a stale `left` for an
  old `sid` removes nothing, `room_finished` ends the call; the sweep ends a call whose room is
  gone and replaces participants; the migration ends live rows and holds the unique index; the
  admin routes are admin-only and the server panel instance-admin-only.
- **vitest:** frames and resync; header buttons per settings; sidebar marks; the call bar's
  states against a fake engine; the two admin pages.
- **In a browser:** LiveKit 1.13.7 locally (Homebrew), its webhook pointed at the dev API; two
  isolated contexts with Chrome's fake camera and microphone. Start a huddle, join from the
  second (avatars and count on both), camera on (stage), share a screen, full screen and back
  with the connection kept, leave — the call ends about 20 s after the last person. Start a
  meetup (full screen). Switch cameras off in the admin page: the camera button goes and the
  grant is refused. Reduced motion emulated; 1440 and 400 px.
- **Gate:** `pnpm check`, `alembic check`, `torsor guard --strict --severity error`.

## Two PRs

1. **Calls foundation, meetups finished, the Video meetups page.** All of the server, including
   the huddle kind; on the client the state, the engine, the call bar, full screen on the shared
   room, the header's Meetup button, the sidebar marks, and the Calls group with its Video
   meetups page.
2. **Huddles.** The header's Huddle button, the audio-first join into the bar, the stage, the
   camera and screen toggles as the settings allow, the Huddles page, the placeholder removed.

Each carries its docs: ADR 0021 (calls), README, the CLAUDE.md meetups paragraph, `help.ts`.

## Not in this

Ringing in DMs. Recording (LiveKit Egress). Notes from Janus after a huddle — LiveKit is built
for voice agents, so this is the natural next step, and a feature of its own. Guests without an
account. A "huddle ended · 20 min" line in the channel. Scheduled meetups. End-to-end
encryption.
