---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-12T14:23:46'
updated: '2026-09-12T14:23:46'
---

# apps/api/src/blob_api/services/unanswered.py

Symbols in `apps/api/src/blob_api/services/unanswered.py`.

- L58 `Question` (class)
- L71 `_time_id(moment: datetime)` (function) — A UUIDv7 whose time bits are `moment`, for bounding an id range by time.
- L76 `excerpt(body: str)` (function)
- L83 `note_for(question: Question)` (function)
- L88 `wants(question: Question)` (function) — Whether this asker should be nudged at all. Muting the channel is an answer too.
- L93 `candidates(session: AsyncSession, *, now: datetime, hours: int=UNANSWERED_AFTER_HOURS, batch: int=BATCH)` (function) — Questions that have gone `hours` unanswered in an opted-in channel, oldest first.
- L188 `claim(session: AsyncSession, question: Question)` (function) — Take the question for this worker. False means another sweep already has it.
- L211 `nudge(session: AsyncSession, question: Question)` (function) — Arm a reminder on the question for its asker, due now.
- L233 `nudged_for(session: AsyncSession, message_id: str)` (function)
