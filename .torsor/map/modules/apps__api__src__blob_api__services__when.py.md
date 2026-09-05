---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T04:19:24'
updated: '2026-09-05T04:19:24'
---

# apps/api/src/blob_api/services/when.py

Symbols in `apps/api/src/blob_api/services/when.py`.

- L76 `When` (class) — A moment, and whether it comes back.
- L84 `Reminder` (class) — What to say, and when to say it.
- L92 `zone_for(name: str)` (function) — The author's zone, or UTC. A zone that has gone away must not raise mid-command.
- L100 `_clock_hour(match: re.Match[str])` (function) — The hour and minute a clock phrase names, or None if it names none at all.
- L129 `_at_local(base: datetime, hour: int, minute: int)` (function) — That time on that day, rebuilt from the wall clock rather than added to it.
- L134 `_resolve(match: re.Match[str], kind: str, now_local: datetime)` (function)
- L199 `parse_when(phrase: str, *, now: datetime, timezone: str)` (function) — A whole phrase read as a moment, or None. The phrase must be only the time.
- L216 `parse_reminder(text: str, *, now: datetime, timezone: str)` (function) — `water the plants tomorrow at 9` → the words and the moment, or None.
- L260 `as_utc(moment: datetime)` (function) — The same instant, in UTC, which is what the schedule row stores.
