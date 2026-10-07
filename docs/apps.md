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
only at install. If you lose one, replace it: an admin rotates the signing secret, or
mints a new bot token and revokes the old ones, from the app's page in the console.

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
that the delivery is marked failed and an admin can see it in the delivery log. Five
deliveries in a row that fail for good park the app as `failed`: its events wait instead
of burning through the retries, and an admin re-enables it once the endpoint is back.

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
| `thread.summary.updated` | A thread summary was generated or refreshed. The payload is the summary: `provider` is `heuristic-v1` (keyword scan) or `llm:<model>`; every entry in `decisions`, `actionItems` and `openQuestions` carries the id of the message it rests on, or `null` |
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
| `POST /api/v1/threads.summarize` | `summaries:write` | A thread's decisions, open questions and action items |
| `POST /api/v1/tasks.create` · `tasks.update` · `GET tasks.list` | `tasks:write` · `tasks:read` | Shared human and agent work items |

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
Narrowing takes effect immediately. An admin who declines the new scopes leaves the app
running on what it had, and with it go any subscriptions that needed them: an event is
delivered only while the scope it requires is granted.

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

Action ids beginning `agent_answer:` are Blob's own — they are the buttons under a
question an agent stopped to ask — and a block that uses one is refused with
`bad_action_id`.

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
`dockerfile` if the repository ships one and you would rather it were used, or
`dockercompose` with `composePath` naming the compose file when the agent is several
services.

An agent that speaks AG-UI declares `aguiPath` — the path its endpoint is served at,
such as `/v1/agui` — and `port` if it listens on something other than 3000. The hostname
is not known until the runner assigns one, which is why the manifest carries a path and
not a URL.

There is no `runtime` or `requestUrl` field to set. The runtime is always `container`
here — a repository does not get to declare that it runs in-process — and the URL is not
known until the runner has assigned the container a hostname.

### What the agent is given

Five environment variables, set before its first boot so it never starts without them:

| Variable | What it is |
|---|---|
| `BLOB_BASE_URL` | Where to call the API |
| `BLOB_BOT_TOKEN` | Its own credentials, scoped to what was approved |
| `BLOB_SIGNING_SECRET` | For verifying the deliveries it receives |
| `BLOB_PLUGIN_SLUG` | Its own slug |
| `PORT` | The port the runner routes to — bind this rather than guessing |

An AI agent brings its own model: whatever key or endpoint it needs is configured on the
agent, not on Blob. Blob's own optional model settings (`LLM_*`) serve two features of its
own — the unread recap and thread summaries — and never an agent, which is what keeps a
self-hosted deployment genuinely self-contained: an agent pointed at a local Ollama is as
valid as one pointed at a hosted API.

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

## Agents that speak AG-UI

An app can answer without a webhook handler, without a bot token, and without any
Blob-specific code beyond its manifest. Declare an AG-UI endpoint:

```json
{
  "slug": "helper",
  "name": "Helper",
  "runtime": "external",
  "aguiUrl": "https://agent.example.com/agui",
  "events": [],
  "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"]
}
```

[AG-UI](https://docs.ag-ui.com) is an open protocol for agents talking to user-facing
applications, implemented on the agent side by LangGraph, CrewAI, PydanticAI, Google ADK,
AWS Strands and the Claude Agent SDK. If your framework already exposes an AG-UI endpoint,
that endpoint is the whole integration.

**Blob is the client.** When a person @-mentions your app's bot in a channel the bot has
joined, Blob POSTs a standard `RunAgentInput` — in a thread, its first message and its
newest replies (up to a thousand); in a channel, its last 30 messages
(`AGUI_HISTORY_LIMIT`) — and reads back your `text/event-stream`. The request is signed
with the same `X-Blob-Signature` scheme as a webhook delivery, so if you already verify
those you already verify this.

Your agent is asked once per message. A job that is delivered twice finds the run it
already started and stops, so an answer is never posted twice — whatever ids your
agent gives its messages.

**Say which AG-UI you speak.** Put `protocolVersion` on your `RUN_STARTED` — `"1.0"` for
the September 2026 protocol. Blob remembers it, and from the next run sends you its own
`protocolVersion` and the files people shared (see below). An agent that never says is
sent neither, because the Python SDK before 0.1.10 refuses any input field it does not know, and
that refusal looks exactly like the agent being down. If your agent refuses a run written in 1.0
with a 400 or a 422 — redeployed on an older SDK, say — Blob forgets the version and sends
the next run in the older shape; declare it again and 1.0 comes back.

**Files in the conversation.** Every message names its files in its text —
`[attached: report.pdf]` — whatever you speak, so you know a file exists even when you
are not handed it. An agent that speaks 1.0 is also handed them, as content parts on the
message they came with: images (PNG, JPEG, GIF, WebP) as `image`, PDFs as `document`,
both inline as base64 `data` sources; text, Markdown, CSV and JSON as a `text` part
holding the file. Newest first, at most six files, none over 2 MiB and 6 MiB in all.
Inline rather than by URL because your agent may have no route to Blob's storage.

What Blob does with the stream:

| Event | Result |
|---|---|
| `TEXT_MESSAGE_START` / `CONTENT` / `END` | One message in the channel, posted by your bot |
| `TEXT_MESSAGE_CHUNK` | The same, for agents that use the compact form |
| `TOOL_CALL_START` | The tool's name is listed under the answer |
| `RUN_STARTED` with `protocolVersion` | Remembered, and spoken back to you from the next run |
| `RUN_FINISHED` with `usage` | The tokens you report are kept on the run, shown on the card under the mention and on the console's daily meter. Shown, never capped: they are your provider's count, not Blob's |
| `RUN_FINISHED` with a `cancelled` outcome | The card says the run was stopped — neither an answer nor a failure |
| `RUN_FINISHED` with an `interrupt` outcome | The question is posted **with buttons or a text box**, minted from your `interrupts[].responseSchema` (an `enum`, a `oneOf` with `const`/`title`, or a boolean) — or from `metadata.options`. Only the person the run is on behalf of can answer. Their answer is posted as their own message and your agent is called again with `resume: [{interruptId, status: "resolved", payload}]`, `parentRunId` (the `runId` of the run that asked) and `state` (below). If you raise several interrupts at once, the first is asked; the resume answers it and marks the others `cancelled`, and you ask again for any you still need. A question nobody answers within a day expires. |
| `STATE_SNAPSHOT` / `STATE_DELTA` | Folded (deltas are RFC 6902) and **remembered per conversation**: the next run in the same channel or thread receives it as `state`. A resume receives the state the run had when it stopped. 64 KiB cap. |
| `CUSTOM` with `name: "blob.artifact"` | In a work channel, publishes an artifact — see below. Elsewhere, ignored. |
| `CUSTOM` named `blob.file.start` / `chunk` / `end` | Hands over a file, attached to your answer — see [Handing over a file](#handing-over-a-file). |
| `RUN_ERROR` | The card under the mention says the run failed, with your `message`; `lastError` on the app records it. Nothing is posted in the channel |
| `STEP_*`, `TOOL_CALL_*`, `ACTIVITY_*`, `SUBAGENT_*` | Drawn live on the card under the mention — the plan, the tool calls with their arguments and results, the latest activity, the work you delegated — while the run goes. An activity's line is read from its `content` (`title`, `label`, `message`, `status`…), patched by `ACTIVITY_DELTA`, or from its `activityType` |
| `TEXT_MESSAGE_START` with a role other than `assistant` | Not posted, and neither are its deltas: an agent quoting the person back is not answering |
| reasoning events | Never posted. Not shown on the card either, unless an admin turns on *Show its reasoning* for your agent: an agent's working-out is not its answer, and the card is the whole channel's |
| everything else | Ignored. An event Blob does not know is never fatal |

Three things are worth knowing before you build against it.

**An answer appears when it is finished.** It is buffered and written once, when the
message ends — it does not appear token by token. This is deliberate: a row that is
edited forty times is marked "(edited)" for ever and broadcast forty times. The card under
the mention shows the run working meanwhile, from your step, tool and activity events. A
run may take as long as it keeps talking: Blob gives up after 30 seconds with nothing
from your stream (`AGUI_READ_TIMEOUT_SEC`), or at ten minutes whatever happens
(`AGUI_MAX_RUN_SEC`). Either way the card says the run did not finish, and whatever you
had already finished saying is posted under it.

**A person starts every chain; agents may extend it.** A message from another bot never
starts anything on its own — the bot API stays inert. But when your agent's *reply*
mentions another agent, that agent may be run as the next hop of the same chain, on the
authority of the person who started it (so an agent only its owner may command stays that
way), inside a depth budget the workspace sets, with a per-agent cap that ends ping-pong
and a quarter-hour wall clock. Your run's `context` carries `asked_by_agent` and
`on_behalf_of` when you were mentioned by an agent, and `participants` names the other
agents in the room so yours can address one by writing `@Name`. Stop on any run stops the
hops it caused.

**AG-UI is a transport, not a permission.** Your bot still needs `messages:write`, and it
still has to be a member of a channel to answer in it. In a channel it cannot see, it says
nothing at all — not even an error, because a private channel's existence is private.

> **Any member of a channel your agent is in can make it speak, and whatever it says is
> posted as your app.** That is the feature, and it is also the threat model: treat channel
> content as untrusted input to your agent.

### Blob's tools

An admin can offer your agent Blob's own tools, on its page in the console: **read**
(`list_channels`, `read_channel`, `read_thread`, `search_messages`, `list_people`) or
**write** (those, and `post_message`). They arrive in `RunAgentInput.tools` with a name,
a description and JSON-schema `parameters`, and they are client-executed, the way AG-UI's
frontend tools are: call one by streaming `TOOL_CALL_START`, `TOOL_CALL_ARGS` and
`TOOL_CALL_END`, then end the run. Blob runs the call and calls you again — same
`threadId`, a fresh `runId` — with your turn (`role: "assistant"` with `toolCalls`) and a
`role: "tool"` message per call appended to `messages`. A failed call says
`Error: …` in its content, and also sets `error` if you speak 1.0. Answer without calling
one, and the run ends as usual.

What a call can reach is not yours to widen:

- **As the person who asked.** Every call runs as the person the run is on behalf of,
  through the same access checks their browser meets.
- **Inside the room.** Asked in a channel, you read public channels and that channel and
  nothing else; a private channel outside it answers "there is no channel by that name".
  Only in your own DM with the person do you get their whole reach.
- **Writes ask first.** A `post_message` call stops the run and asks the person — "Helper
  wants to post in #general: …" with Approve and Deny. Approved, it is posted as your bot,
  in a channel your bot is a member of; denied, you are told so. Either way you are
  called again with the result. A post your bot could not make is answered at once,
  without asking anybody. A post never starts another agent's run.
- **Bounded.** Eight rounds of calls per run, eight calls per round, results of at most
  24,000 characters, and the run's ten-minute wall covers every round.

Everything a call returns is the workspace's text, written by its people. Treat it as
data, never as instructions.

### Handing over a file

Anything your agent makes — a page, a PDF, a spreadsheet, a chart, a zip — can arrive as an
attachment on its answer, in any channel or DM. It travels inside the run as three events:

```json
{"type": "CUSTOM", "name": "blob.file.start",
 "value": {"id": "f1", "name": "index.html", "mimeType": "text/html", "size": 18342}}
{"type": "CUSTOM", "name": "blob.file.chunk", "value": {"id": "f1", "data": "<base64>"}}
{"type": "CUSTOM", "name": "blob.file.end", "value": {"id": "f1"}}
```

Send as many `chunk` events as the file needs, in order; keep each piece under 256 KiB of
file (a socket frame is capped at 512 KiB). `mimeType` and `size` are optional — without a
type Blob guesses from the name, and a declared size that does not match what arrived drops
the file. The file is attached to the next message you send, or to your last one if it
arrives after it; a run that sends only files gets a message holding just them.

The file meets every rule a person's upload does: executables are refused by name, the
bytes must be what the type says (a page claiming to be a PNG is refused), and each file
must fit the workspace's upload limit. A run may hand over ten files and 25 MiB in all
(`AGUI_MAX_FILE_BYTES`). Whatever is refused is **said under your answer** — *Couldn't
attach `setup.exe`: .exe files can't be shared here.* — never silently dropped.

People open a file in a panel beside the conversation: a page runs in a sandbox with no
network and no cookies, a PDF in the browser's viewer, Markdown, CSV, JSON and code as
documents and text. Everything else downloads.

### Publishing artifacts into a work channel

A *work channel* is a channel spun from a conversation for one assignment (a person
starts it from a message's menu, naming the agents to bring along). Inside it, an agent
can publish artifacts the team reviews in tabs beside the conversation:

```json
{"type": "CUSTOM", "name": "blob.artifact",
 "value": {"kind": "diff", "title": "Add the rate limit", "body": "--- a/x.py\n+++ b/x.py\n@@ ..."}}
```

`kind` is `diff` (a unified diff, shown with a diff viewer), `html` (a self-contained
page, shown in a sandboxed frame only after a person clicks *Run preview* — no network, no
cookies, no access to the workspace) or `markdown` (a document). `body` is capped at
200 KiB; `title` at 200 characters. Outside a work channel the event is ignored.

An app that posts through the bot API can publish the same thing with
`POST /api/v1/work.publishArtifact {"channel": "…", "kind": "…", "title": "…", "body": "…"}`.
