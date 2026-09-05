---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-05T07:22:54'
updated: '2026-09-05T07:22:54'
---

# apps/api/src/blob_api/routers/work.py

Symbols in `apps/api/src/blob_api/routers/work.py`.

- L35 `StartWorkInput` (class)
- L42 `PublishInput` (class)
- L48 `WorkOut` (class)
- L53 `WorkDetailOut` (class)
- L58 `ArtifactOut` (class)
- L62 `OkOut` (class)
- L66 `work_event(work: work_service.Work)` (function) — `work.updated`: the record changed — an artifact landed, or it finished.
- L78 `start_work(payload: StartWorkInput, request: Request, user: SessionUser=Depends(current_user))` (function) — Spin a channel for this assignment from the message it began with.
- L124 `work_for_channel(channel_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L137 `read_work(work_id: IdParam, user: SessionUser=Depends(current_user))` (function)
- L146 `publish_artifact(work_id: IdParam, payload: PublishInput, request: Request, user: SessionUser=Depends(current_user))` (function) — A person puts something into the work by hand — a diff they wrote, a page, notes.
- L182 `finish_work(work_id: IdParam, request: Request, user: SessionUser=Depends(current_user))` (function) — Done. The channel archives; the history stays.
