---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-23T03:37:20'
updated: '2026-09-23T03:37:20'
---

# apps/api/src/blob_api/services/calls.py

Symbols in `apps/api/src/blob_api/services/calls.py`.

- L71 `_cols(prefix: str)` (function)
- L75 `_to_call(row: Any, participant_ids: list[str] | None=None)` (function)
- L88 `_enabled(config: CallSettings, kind: CallKind)` (function)
- L92 `_cap(config: CallSettings, kind: CallKind)` (function)
- L96 `sources_for(config: CallSettings, kind: CallKind)` (function) — What a participant may publish. A meetup is cameras; a huddle is a voice first,
- L114 `_off(kind: CallKind)` (function)
- L120 `_not_configured()` (function)
- L124 `_unavailable()` (function)
- L130 `_ensure_room(call_id: str, cap: int)` (function)
- L138 `_participants(session: AsyncSession, call_ids: list[str])` (function)
- L159 `_get(session: AsyncSession, workspace_id: str, call_id: str)` (function)
- L172 `_live(session: AsyncSession, channel_id: str, kind: CallKind)` (function)
- L184 `start(session: AsyncSession, after: AfterCommit, user: SessionUser, channel_id: str, kind: CallKind)` (function) — Start a call of this kind in this conversation — or join the one that is live.
- L234 `token(user: SessionUser, call_id: str)` (function) — A pass into the call's room, publishing what the workspace allows.
- L265 `_finish(session: AsyncSession, after: AfterCommit, call_id: str)` (function) — Mark a live call ended and forget who was in it. None when it was already over.
- L290 `end(user: SessionUser, call_id: str)` (function) — End a call for everyone: its starter's call to make, or an admin's.
- L325 `state_for(session: AsyncSession, user: SessionUser)` (function) — What the client starts from, and resyncs from after a reconnect.
- L349 `_note_event()` (function)
- L356 `_announce_participants(session: AsyncSession, after: AfterCommit, call_id: str, channel_id: str)` (function)
- L368 `apply_webhook(event: Any)` (function) — One verified event. Anything not about a live call of ours is ignored: LiveKit
- L425 `_still_allowed(session: AsyncSession, channel_id: str, identities: list[str])` (function) — Which of `identities` may still be in a call on `channel_id`: a member, and not
- L465 `_replace_participants(call_id: str, channel_id: str, present: list[livekit.Participant])` (function)
- L527 `reconcile()` (function) — Once a minute: make the live calls agree with what LiveKit says, whatever the
- L556 `_reconcile()` (function)
- L605 `save_settings(session: AsyncSession, after: AfterCommit, actor: Actor, value: CallSettings)` (function) — Replace the workspace's `calls` key and nothing else in its settings.
- L636 `media_server_status()` (function) — What the instance admin needs to know about LiveKit, asked of LiveKit itself.
