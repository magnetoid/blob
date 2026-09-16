---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/meetups.py

Symbols in `apps/api/src/blob_api/routers/meetups.py`.

- L27 `_visible(session: AsyncSession, user: SessionUser, meetup_id: str)` (function) — The meetup, if this person may see it: same workspace, and a member of its
- L39 `create_meetup(input_: MeetupCreate, user: SessionUser=Depends(current_user))` (function)
- L56 `get_meetup(meetup_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L62 `get_meetup_token(meetup_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L71 `end_meetup(meetup_id: IdParam, user: SessionUser=Depends(current_user))` (function)
