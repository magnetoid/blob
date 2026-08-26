# `/ws/agent` — the protocol a desktop agent speaks

For an agent with no address: on a laptop, behind NAT, on a network this server cannot
see. It dials Blob and holds a WebSocket, and runs go down that pipe. Only the *transport*
reverses — the agent still answers runs it did not start, and the same code reads the same
events as on the HTTP path. See ADR 0012.

**Blob is the AG-UI client and the agent is the server**, on both transports. Everything
below is a thin envelope around AG-UI events; nothing here replaces the protocol.

- Endpoint: `wss://<your-blob>/ws/agent`
- Handler: [routers/agent_socket.py](../apps/api/src/blob_api/routers/agent_socket.py)
- Routing, claiming and cross-process delivery: [plugins/gateway.py](../apps/api/src/blob_api/plugins/gateway.py)
- A working client: [tools/agent_bridge.py](../apps/api/src/blob_api/tools/agent_bridge.py)

## Authentication

**The credential is the app's bot token**, minted by Blob when the app is registered —
`blob-bot-…`. It is deliberately *not* a shared server-wide secret. A per-app token
identifies one agent, carries that app's scopes, is revocable on its own, and stops
working the moment an admin disables the app. None of that is true of one secret every
agent shares.

Two ways to present it, because a desktop agent is not a browser and a browser cannot set
headers:

```
Authorization: Bearer blob-bot-…          ← preferred
{"t": "auth", "token": "blob-bot-…"}      ← first frame, if you cannot set headers
```

Deliberately **not** a query parameter: `?token=` is the third thing every client library
supports and the first thing every reverse proxy writes to an access log.

| Rule | Value |
|---|---|
| Time allowed to authenticate | 10s (`AUTH_DEADLINE_SEC`) |
| Close code, unauthenticated | **1008** |
| Close code, unparseable frame | 1003 |
| Maximum frame | 512 KiB (`MAX_FRAME_BYTES`) |
| Run ceiling | `AGUI_TIMEOUT_SEC + AGUI_READ_TIMEOUT_SEC` — 150s by default |

Comparison is constant-time and the failure is uniform: "unknown token", "revoked" and
"app disabled" all close the same way, because which one it was is not the caller's
business. The workspace policy `may_connect_socket_agents` is re-checked on **every**
connection rather than only at install, so revoking the capability takes effect on the
next reconnect — and a laptop reconnects often.

## Frames

Every frame is a JSON object with a `t` discriminator. **Unknown frame types are ignored,
never fatal**, on both sides: this protocol will gain frames, and a strict reader turns
next month's addition into a dead agent.

### Blob → agent

```jsonc
{"t": "ready", "pluginId": "…", "botUserId": "…", "name": "Janus", "scopes": ["messages:write"]}
{"t": "run",   "runId": "…", "input": { /* AG-UI RunAgentInput */ }}
{"t": "pong"}
{"t": "hello_ok"}
{"t": "error", "message": "That frame is not JSON."}
```

`ready` arrives immediately after successful authentication and is the signal to start
working. `input` is a standard AG-UI `RunAgentInput`: `threadId`, `runId`, `state`,
`messages`, `tools`, `context`, `forwardedProps`.

### Agent → Blob

```jsonc
{"t": "auth",  "token": "blob-bot-…"}
{"t": "hello", "name": "Janus", "description": "…", "version": "1.2.0"}
{"t": "ping"}
{"t": "event", "runId": "…", "event": { /* one AG-UI event */ }}
{"t": "done",  "runId": "…"}
```

`hello` is the import, such as it is: connecting *is* registering, so an agent says what
it is on the way in rather than being described by hand in a console it has never heard
of. What it may **do** is not up for self-declaration — scopes stay whatever an admin
approved, or this would be an app granting itself permissions by asserting them.

`event` carries AG-UI events verbatim. Remember that the wire `type` values are
SCREAMING_SNAKE (`TEXT_MESSAGE_START`) and field names are camelCase (`messageId`) — the
published docs head each section with the TypeScript interface name, and matching those
headings parses as nothing, silently.

**`done` ends a run and must always be sent.** Blob holds the run open until it is told
otherwise, so an agent that fails without saying so costs the person a full 150 seconds of
silence — the one outcome worse than an error. Send `RUN_ERROR` as an event and then
`done`.

## About the proposed `agent.auth` / `chat.request` shape

That protocol was not adopted, because this one already exists, is tested end to end, and
carries something the proposal does not: an **AG-UI event stream**, not a single finished
string. `chat.response` with one `message` field cannot express tool calls, interrupts, a
reply split across several messages, or a run that legitimately says nothing — all of
which Blob already renders. Every requirement in that spec is met here under different
names:

| Asked for | Here |
|---|---|
| `agent.auth` | `Authorization: Bearer`, or `{"t":"auth"}` |
| `agent.ready` | `{"t":"ready"}` |
| `chat.request` | `{"t":"run"}` with a `RunAgentInput` |
| `chat.response` | a stream of `{"t":"event"}`, then `{"t":"done"}` |
| `chat.error` | `{"t":"event"}` carrying `RUN_ERROR` |
| `ping` / `pong` | `{"t":"ping"}` / `{"t":"pong"}` |
| close 1008 on bad auth | `CLOSE_UNAUTHORIZED = 1008` |
| `AGENT_WEBSOCKET_TOKEN` | the app's own bot token — narrower, and revocable per agent |

### Delivery guarantees, honestly

What holds today:

- Every run has a `runId`, and events are addressed by it, so answers cannot be attributed
  to the wrong run.
- A run is claimed with Redis `SET NX` before an agent is asked, so a duplicate enqueue
  does not pay for the same run twice, and an agent reconnecting to a second app process
  cannot have one run delivered and answered twice.
- Runs are bounded by `AGUI_TIMEOUT_SEC + AGUI_READ_TIMEOUT_SEC` and by event and byte
  caps, so a flooding agent costs a bounded amount of somebody else's latency.
- Every post the agent produces is idempotent on a client-supplied id, so a retried
  delivery cannot double-post a message.

What does **not** hold, stated plainly rather than implied:

- **A run is not persisted while it is in flight.** If the socket drops mid-run, that run
  is lost — the person sees the agent say nothing. It is not requeued.
- **There is no `chat.ack`.** Blob does not wait for the agent to acknowledge a run before
  considering it delivered.

Both are deliberate for now: a lost run in a chat message is a question you ask again,
and a queue that survives disconnects is a durable-work-queue feature, with the retry,
deduplication and poison-message questions that implies. `agent_runs` records what
happened either way, so a run lost this way is visible in the console rather than
invisible.

## Running the bridge

`tools/agent_bridge.py` holds the socket and forwards each run to an AG-UI server already
running on the same machine — it does not implement an agent. That means the agent's own
tested AG-UI path answers, unmodified, and it works for anything that speaks the protocol.

```bash
export BLOB_URL=https://chat.example.com
export BLOB_BOT_TOKEN=blob-bot-…            # shown once, when you add the app
export AGENT_AGUI_URL=http://127.0.0.1:8642/v1/agui
export BLOB_SIGNING_SECRET=…                # the secret the local agent verifies with
export AGENT_NAME=Janus                     # optional, sent in `hello`

python -m blob_api.tools.agent_bridge
```

It reconnects with exponential backoff and full jitter — fifty agents reconnecting on the
same schedule is how a server that just came back goes down again — and exits rather than
retrying when the token is refused, because a dead credential does not get better by
hammering the endpoint.

Nothing is logged that would leak a secret or a message body: connection, authentication,
disconnection and run ids only.
