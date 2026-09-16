---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-16T03:06:37'
updated: '2026-09-16T03:06:37'
---

# apps/api/src/blob_api/routers/work.py

Symbols in `apps/api/src/blob_api/routers/work.py`.

- L34 `StartWorkInput` (class)
- L41 `PublishInput` (class)
- L47 `WorkOut` (class)
- L52 `WorkDetailOut` (class)
- L57 `ArtifactOut` (class)
- L61 `work_event(work: work_service.Work)` (function) — `work.updated`: the record changed — an artifact landed, or it finished.
- L73 `start_work(payload: StartWorkInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Spin a channel for this assignment from the message it began with.
- L117 `work_for_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L130 `read_work(work_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L139 `publish_artifact(work_id: IdParam, payload: PublishInput, request: Request, user: SessionUser=Depends(current_user))` (function) — A person puts something into the work by hand — a diff they wrote, a page, notes.
- L175 `finish_work(work_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Done. The channel archives; the history stays.
