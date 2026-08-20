# Multilingual Translation Design And Rollout

Date: 2026-08-20

## Scope

This document covers the final high-priority gap from the agentic workspace benchmark:

1. provider-backed text translation for internal messages
2. user language preferences
3. inline translated-message UX
4. cache invalidation after message edits

## Product Goals

1. Let multilingual teams read the same conversation without leaving Blob.
2. Preserve the original message while showing a translated copy inline.
3. Keep translation outside the hot message write path.
4. Support enterprise-friendly provider choice: DeepL or LibreTranslate.

## Architecture

### Backend

New pieces:

1. `message_translations` table for cached per-message translations.
2. `translation.py` service with provider adapters.
3. `POST /api/messages/{message_id}/translate` route.
4. new config surface:
   - `TRANSLATION_PROVIDER`
   - `TRANSLATION_BASE_URL`
   - `TRANSLATION_API_KEY`
   - `TRANSLATION_TIMEOUT_SEC`

Flow:

1. user requests translation or auto-translate triggers in the web UI
2. server verifies channel access on the source message
3. server resolves target language from request or user prefs
4. server returns cached translation when the source body matches
5. otherwise the configured provider is called
6. result is cached and returned

### Frontend

New UX:

1. preferred language in Settings
2. optional auto-translate toggle
3. inline `Translate / Show / Hide / Refresh` controls on message rows
4. translated message card rendered under the original message

## Security And Compliance Notes

1. Translation uses existing message access checks, so users cannot translate messages they cannot read.
2. Original message storage is unchanged; translation is additive and cacheable.
3. Provider access is explicit and environment-driven, which keeps data egress controlled.
4. Translation is disabled by default until a provider is configured.
5. Agent audit logging remains unchanged; translation does not weaken RBAC or bot controls.

## Rollout Plan

### Phase 1: Foundation

Completed.

1. add translation config
2. add cached translation table
3. add server route and provider adapters
4. add language preferences
5. add inline translation UI

### Phase 2: Operational Hardening

Next recommended increment.

1. provider health telemetry
2. admin-visible translation configuration checks
3. character-volume monitoring
4. redaction rules for regulated deployments if required

### Phase 3: Enterprise Language Controls

Recommended after packaged connectors.

1. glossary support
2. translation memory
3. workspace language policy
4. approved language set per workspace

## Test Cases

### Backend

1. translation uses user preferred language when no explicit target is provided
2. cached translations are returned on repeat requests
3. edited messages invalidate stale cache entries automatically
4. translation without a target language is rejected
5. provider-disabled mode returns an availability error

### Frontend

1. language preference persists through the existing prefs API
2. auto-translate only activates when a preferred language is set
3. translated copy renders inline without replacing the source message
4. refresh pulls a new translation after edits or provider changes
5. offline message delivery states remain unaffected

## User Acceptance Criteria

1. A user can choose a preferred language from Settings.
2. A user can enable auto-translate for incoming messages.
3. A translated copy appears inline for readable messages with text content.
4. The original message stays visible for trust and review.
5. Repeated translation requests on the same unchanged message are fast because they are cached.
6. Editing a message causes a fresh translation to be generated on the next request.

## Verification Run

Completed verification in this workspace:

1. `uv run ruff check src tests`
2. `uv run mypy src`
3. `uv run pytest -q`
4. `pnpm --filter @blob/web typecheck`
5. `pnpm --filter @blob/web test`
6. `pnpm --filter @blob/web build`
7. `pnpm typecheck`
8. `pnpm build`
9. `pnpm test`

## Deployment Notes

The code is deployment-ready, but production activation requires environment configuration.

Example:

```env
TRANSLATION_PROVIDER=deepl
TRANSLATION_API_KEY=your-key
TRANSLATION_BASE_URL=https://api.deepl.com
TRANSLATION_TIMEOUT_SEC=10
```

Or:

```env
TRANSLATION_PROVIDER=libretranslate
TRANSLATION_BASE_URL=https://libretranslate.com
TRANSLATION_API_KEY=
TRANSLATION_TIMEOUT_SEC=10
```

Run migration before release:

```bash
pnpm migrate
```
