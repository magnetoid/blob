# Building an app for Blob

An app is a program that Blob sends events to and that calls Blob back. It gets a name, an
avatar and a place in the member list, because **a bot is a real user** — everything that
works for a person works for it.

Two runtimes exist. This document covers **external apps**, which run wherever you run
them and talk to Blob over HTTP. Local plugins run inside the server process and are
installed by deploying code; see [Local plugins](#local-plugins) for why they are not
installable from the console.

---

## Installing

An admin registers your app in **Administration → Apps** with a manifest. The Apps screen
now ships in the web admin console, including install, approve, enable/disable, secret
rotation, token issuance/revocation and delivery-log inspection:

```json
{
  "slug": "standup-bot",
  "name": "Standup Bot",
  "description": "Collects standup notes every morning",
  "runtime": "external",
  "version": "1.0.0",
  "requestUrl": "https://apps.example.com/blob/events",
  "events": ["message.created"],
  "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"]
}
```

Installing returns two secrets, **once**:

| Secret | What it is for |
|---|---|
| `signingSecret` | Verifying that a delivery really came from Blob |
| `botToken` | Authenticating your calls back into Blob |

Neither is retrievable afterwards — Blob stores a hash of the token and shows the secret
only at install. If you lose one, rotate it; that is the recovery path.

`requestUrl` must be `https://` and must resolve to a public address. A URL pointing at a
private range is refused, because otherwise registering an app would be a way to make the
server issue requests against its own network.

## Receiving events

Blob POSTs JSON to your `requestUrl`:

```http
POST /blob/events HTTP/1.1
Content-Type: application/json
X-Blob-Request-Timestamp: 1755657600
X-Blob-Signature: v0=8f2a…
X-Blob-Delivery-Id: 019893a1-7c4e-7000-8000-2b1f8a9c0001

{"event":"message.created","payload":{"id":"…","channelId":"…","body":"…"}}
```

**Verify the signature before doing anything else.** It is HMAC-SHA256 over the string
`v0:{timestamp}:{raw body}` — the raw bytes, before any JSON parsing or re-serialising.

```python
import hashlib, hmac, time

def verify(secret: str, timestamp: str, signature: str, body: bytes) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False                      # too old to accept; a replay, or a bad clock
    expected = "v0=" + hmac.new(
        secret.encode(), f"v0:{timestamp}:".encode() + body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

The timestamp is inside the signed string, which is what makes a captured request stop
working rather than being replayable forever with a fresh header.

**Answer quickly, then work.** Blob waits 10 seconds. Return 2xx as soon as you have the
event and do the real work afterwards.

**Deduplicate on `X-Blob-Delivery-Id`.** A retry after a timeout carries the same id as
the attempt that may in fact have succeeded — at-least-once delivery, so the same event
can arrive twice.

### Retries

Any non-2xx response, or no response, is retried after 1s, 5s, 30s, 5m and 30m. After
that the delivery is marked failed and an admin can see it in the delivery log.

**Return `410 Gone` to stop permanently.** It is the one status that means "this app is
finished" — use it when your side has been uninstalled, instead of refusing deliveries
forever.

While an app is disabled, its events queue rather than fail: re-enabling resumes the
backlog instead of starting from a pile of failures.

### Events

| Event | Fires when |
|---|---|
| `message.created` | A message was posted |
| `message.updated` | A message was edited |
| `message.deleted` | A message was deleted |
| `thread.summary.updated` | A thread summary was generated or refreshed |
| `task.created` | A human or agent task was created |
| `task.updated` | A human or agent task changed state |
| `reaction.added` / `reaction.removed` | Someone reacted |
| `channel.created` | A channel was created |
| `member.joined` / `member.left` | Someone joined or left a channel |

Your app is never woken by its own messages — otherwise an app that posts on
`message.created` would answer itself forever.

**You only hear what your bot could read.** Anything that happens in a channel is
delivered on the same terms the API applies to fetching it: public channels reach every
app, and a private channel or a DM reaches only an app whose bot was actually invited
to it. Subscribing to `message.created` is not a way to read the workspace — if you
need an app to see a private channel, add its bot to that channel the way you would add
a person.

There are no presence, typing or read-state events, and there will not be. They reveal
who is at their desk minute by minute, and nothing an app legitimately does needs that.

The delivery log in **Administration → Apps** shows pending and failed attempts so an
operator can see whether an app is misconfigured, disabled, or simply backlogged.

## Calling Blob

Send your bot token as a bearer token:

```bash
curl -X POST https://chat.example.com/api/v1/chat.postMessage \
  -H "Authorization: Bearer blob-bot-…" \
  -H "Content-Type: application/json" \
  -d '{"channel":"#general","text":"Build 4711 passed."}'
```

| Method | Scope | Notes |
|---|---|---|
| `GET /api/v1/auth.test` | — | Confirms the token and lists its scopes. Start here. |
| `POST /api/v1/chat.postMessage` | `messages:write` | `channel` takes an id or `#name` |
| `POST /api/v1/chat.update` | `messages:write` | Someone else's message needs `messages:moderate` |
| `POST /api/v1/chat.delete` | `messages:write` | Same |
| `POST /api/v1/reactions.add` | `reactions:write` | |
| `GET /api/v1/conversations.list` | `channels:read` | What the bot can see |
| `POST /api/v1/conversations.join` | `channels:join` | Required before posting |
| `GET /api/v1/users.list` | `users:read` | Email is never included |

**Your bot must join a channel before posting to it.** Its access is its own, checked
exactly as a person's is — so a private channel it was not invited to returns 404, not
403, because the existence of a private channel is itself private.

**Sending twice is safe if you say so.** Pass a stable `clientMsgId` and a retry stores
nothing new and returns the same message:

```json
{"channel": "#builds", "text": "Build 4711 passed.", "clientMsgId": "build-4711"}
```

## Permissions

Scopes are granted as a set at install. An update that asks for **more** than it was
granted puts the app into `needs_review` and stops it doing anything at all until an
admin approves — an app cannot widen its own permissions by shipping a new version.
Narrowing takes effect immediately.

Missing a scope returns 403 with `{"error":{"code":"missing_scope"}}`.

## When something is wrong

`GET /api/v1/auth.test` tells you whether the token is live and what it can do.

Admins see the delivery log per app — every attempt, its status code and its error. That
is the first place to look when your app says it heard nothing.

| Symptom | Usually |
|---|---|
| 401 on every call | Token revoked, or the app was uninstalled |
| 403 on every call | The app is disabled or waiting for review |
| 403 on one call | Missing that scope |
| 404 posting to a channel | The bot has not joined it, or it is private |
| No events arriving | Not subscribed, signature rejected, or your endpoint is not 2xx |

## Local plugins

Local plugins run **inside** the server process. A local plugin can read the environment,
query the database directly and forge a session: the scopes it declares are an
ergonomics and audit boundary, not a security one, and Python has no in-process sandbox
worth pretending otherwise about.

So installing one is deliberately not something the console can do. Local plugins are
loaded from the filesystem at boot, which makes installing one a deploy — with a commit
and a review behind it.

> **Local plugins are trusted code. Installing one is equivalent to deploying server
> code. If you need to run code you do not fully trust, write an external app.**

The local runtime is not built yet; external apps are.

## Blocks

A message can carry structured content beside its text. Seven types, and the list is
closed on purpose: a block vocabulary grows until it is a layout engine, and a layout
engine inside a chat message is a rendering surface nobody can review.

```json
{
  "channel": "#builds",
  "text": "Build passed on main",
  "blocks": [
    { "type": "section", "text": { "text": "Build **passed** on `main`" } },
    { "type": "fields", "fields": [{ "text": "*Took*: 2m14s" }, { "text": "*By*: ana" }] },
    { "type": "divider" },
    { "type": "actions", "elements": [
      { "type": "button", "actionId": "deploy", "text": "Deploy", "style": "primary" },
      { "type": "button", "actionId": "cancel", "text": "Cancel" }
    ]}
  ]
}
```

`section`, `fields`, `divider`, `context`, `image`, `actions` (button and select), and
`input`. Anything else is refused, and keys the schema does not declare are dropped
before storage rather than kept and passed to the renderer.

**`text` is not optional.** It stays the plain-text fallback and remains the only thing
the search index reads, so it should say what the blocks say. A client that cannot render
blocks still shows something true.

### Interactions

When someone uses a button or a select, the app subscribed to `interaction.triggered`
receives it — and only that app, because an interaction is a reply to whoever published
the action:

```json
{
  "event": "interaction.triggered",
  "payload": {
    "messageId": "...", "channelId": "...",
    "actionId": "deploy", "value": "", "userId": "..."
  }
}
```

The server accepts an interaction only if its `actionId` appears in the blocks stored on
that message. That single check is the whole security story: the server holds the blocks,
so a client cannot invent an action and an app can never be handed an id it did not
publish. Deleting a message takes its buttons with it.

## Agents deployed from a repository

An agent can be installed by pasting its repository URL instead of typing a manifest.
Blob reads the manifest, shows the scopes for approval, then asks a runner to build the
repository and run it as its own container.

This does not change the trust model. A container agent **is an external app** — same
scoped `/api/v1/` API, same bot user, same signed deliveries. The only difference is who
arranged the hosting. Nothing from the repository runs inside the server process, so the
rule above still holds.

### What the repository needs

A `blob-app.json` at its root:

```json
{
  "slug": "standup-agent",
  "name": "Standup Agent",
  "description": "Asks what everyone did yesterday",
  "version": "1.0.0",
  "build": "nixpacks",
  "events": ["message.created"],
  "scopes": ["messages:read", "messages:write"]
}
```

`build` is optional. The default, `nixpacks`, reads the repository and works out how to
build it, which covers an ordinary Python or Node project with nothing added. Use
`dockerfile` if the repository ships one and you would rather it were used.

There is no `runtime` or `requestUrl` field to set. The runtime is always `container`
here — a repository does not get to declare that it runs in-process — and the URL is not
known until the runner has assigned the container a hostname.

### What the agent is given

Four environment variables, set before its first boot so it never starts without them:

| Variable | What it is |
|---|---|
| `BLOB_BASE_URL` | Where to call the API |
| `BLOB_BOT_TOKEN` | Its own credentials, scoped to what was approved |
| `BLOB_SIGNING_SECRET` | For verifying the deliveries it receives |
| `BLOB_PLUGIN_SLUG` | Its own slug |

An AI agent brings its own model: whatever key or endpoint it needs is configured on the
agent, not on Blob. Blob has no LLM dependency and no model credentials of its own, which
is what keeps a self-hosted deployment genuinely self-contained — an agent pointed at a
local Ollama is as valid as one pointed at a hosted API.

### Turning it on

Hosting is off by default, and off is a normal state: agents can still be registered as
external apps and run wherever their author put them. To enable it, set `AGENT_RUNNER`
and the runner's credentials.

Blob never holds the Docker socket. The Coolify runner asks Coolify — which already owns
that privilege on a host running it — to create and deploy the application. On a machine
running anything else, that separation is the difference between a compromise of the chat
app and a compromise of the box.

> **Deploying an agent runs someone else's code on your server, in its own container with
> only the scopes you granted. It cannot reach the workspace except through the API every
> app uses.**
