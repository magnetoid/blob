---
type: decision
status: accepted
tags: [adr, calls, livekit, realtime, client]
links:
  [
    0002-uuidv7-primary-keys,
    0003-hand-tuned-sql-stays-sql,
    0004-persist-then-broadcast,
  ]
rules: []
---

# Calls are LiveKit rooms that belong to a conversation

## Context

A meetup never ended. `create_meetup` inserted a row every time it was called, with
nothing to look up whether a channel already had a live one and nothing stopping two — so
clicking Start twice, or once after a reload, orphaned whichever room you had just been
in, and no path anywhere ever flipped a row from `active` to `ended`. Every meetup created
since the feature shipped was still `active` in the database (0045's migration found them
and closed every one of them outright).

Reloading, or just navigating back to the channel, lost your way back to the one you were
just in. There was no channel-level "a meetup is live here" — no bar, no badge, nothing —
only a URL you had to still be holding, and clicking Start again started a different room
than whoever you left behind was still sitting in. Leaving the room's own screen was
worse: `MeetupView` rendered LiveKit's `<LiveKitRoom>` directly, which owns a connection
for exactly as long as it is mounted, so opening any other channel unmounted it and hung
up the call — mid-meeting, with no warning, for a person who thought they had just checked
another conversation for a second.

Huddles were next on the roadmap and would have needed the same room, the same access
check, and the same everything-but-the-camera-default as a meetup. Building that twice
was the wrong shape before writing a line of it.

## Decision

**One call primitive, two kinds.** A `calls` table — `meetups`, renamed and given a `kind`
column (0045) rather than a second table — holds a huddle and a video meetup alike, with
one service (`services/calls.py`), one router for a person (`routers/calls.py`) beside the
admin one the console reads, one client engine
(`features/calls/engine.ts`). The two kinds differ only in what they default to and what a
participant's token may publish (`sources_for`); everything about starting, joining,
authorising and ending one is the same code path. Starting a call that is already live in
the conversation joins it instead of starting a second one, which is what `calls_one_live`
— a partial unique index on `(channel_id, kind) WHERE status = 'active'` — makes true even
when two people click at the same moment: the insert that loses the race reads back
whichever row won and joins that one.

**Presence is LiveKit's webhooks plus a sweep, never the client's say-so.**
`apply_webhook` applies one signature-verified event at a time —
`participant_joined`, `participant_left`/`participant_connection_aborted`,
`room_finished` — and a worker cron (`sweep_calls`, once a minute) asks LiveKit directly
for whatever a webhook did not deliver: it closes a call whose room LiveKit no longer
knows about, once that call has had long enough for its starter to actually have
connected, and it replaces a call's participant rows wholesale with whatever LiveKit
currently reports being in the room. Nothing about who is in a call is decided by a
client's own claim to have joined or left.

**A participant exists only while connected.** `call_participants` gets a row on join and
loses it on leave or on the call ending — never a status column, never a `left_at`. Blob
keeps no attendance history for a call; there was no version of this design where it did,
so there is nothing to migrate away from later.

**A workspace's settings live in the token and the room, not in anything Blob polices
while a call is running.** Once a participant is connected, media runs between their
browser and LiveKit — Blob is not in that path and cannot be asked to enforce anything
against it mid-call. So `sources_for` decides, at the moment a token is minted, exactly
which sources it may publish (a huddle's camera and screen share only if the workspace
has turned them on; a meetup always gets both), and a workspace's participant cap is set
once, at room creation, as LiveKit's own `max_participants`. Whatever a workspace's
settings say is enforced by what the token permits and what the room accepts, not by
Blob watching the call.

**The LiveKit connection is one `Room`, owned outside React.** `features/calls/engine.ts`
holds it in module state, not in whichever component currently renders the call, because
more than one surface shows the same call — the bar and the full-screen view today — and
each mounts and unmounts as you move around the app, which is exactly what used to hang up
a call on navigation. `engine.ts` tracks its own newest connection attempt independently
of any component's lifecycle (a `pending`/`current` pair, not a ref inside a component),
so a leave, a rejoin or a switch that lands while an older attempt is still connecting
resolves onto whichever attempt is actually still wanted, and `CallAudio` renders from the
same object so the call's audio survives a route change that would have unmounted a
component-owned one.

## Alternatives considered

**The media server: kept LiveKit, after checking Jitsi, mediasoup and Janus (the WebRTC
gateway — an unrelated project that happens to share a name with the agent Blob seeds,
worth saying once so nobody reads the wrong one into this file).** What this design leans
on hardest is not "a working SFU" — all four are that — but three specific primitives:
a webhook LiveKit signs itself and Blob verifies (`lib/livekit.py:receive`), a REST room
service Blob can create, list, close and list-participants against
(`api.LiveKitAPI(...).room`), and a JWT token that scopes exactly what a participant may
publish (`VideoGrants.can_publish_sources`). LiveKit ships all three as its own API,
used here directly rather than rebuilt. mediasoup is a lower-level engine and deliberately
none of those things — no signalling server, no room concept, no webhook system, no admin
API of its own — so this design would still have to build every one of them on top of it.
Jitsi's Videobridge is the engine inside Jitsi Meet, built to power that product's own
meeting UI; both an admin API shaped for Blob's own token/room model and a client that is
not Jitsi Meet's UI fit it less naturally than LiveKit's dedicated `RoomService` and
`@livekit/components-react`, which `features/calls/CallView.tsx` uses directly for its
video grid. Janus is a general-purpose, plugin-based gateway a level below LiveKit in the
same way — it speaks SIP and RTSP as well as WebRTC, which this design never needed — with
a thinner client SDK ecosystem than LiveKit's React components.

## Consequences

- A LiveKit that cannot reach Blob's webhook — a firewall rule not opened, a URL
  misconfigured — degrades presence to the sweep's own cadence: the participant list and
  a call's end both catch up within a minute instead of immediately, rather than going
  wrong. This is the same "degrades that one thing" shape as every other optional
  dependency in this codebase, not a new failure mode.
- The webhook route, `POST /api/calls/livekit`, is necessarily public — LiveKit holds no
  Blob session to send with a request — and is listed in `PUBLIC_ROUTES` as an exact
  `(method, path)` pair rather than a prefix, the same reasoning `/api/mcp` already
  established: what makes an event real is LiveKit's own signature over the body, checked
  before anything in it is trusted, and a bad one is refused (`BadSignature`) rather than
  silently ignored.
- An old `/meetup/:id` link still opens. `router.ts` matches `call` and `meetup` in the
  same pattern, so a link shared or bookmarked before this rename keeps resolving to the
  same call rather than 404ing the day this shipped.
