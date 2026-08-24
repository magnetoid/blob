---
type: decision
status: accepted
tags: [adr, plugins, agents, protocol, realtime]
links: [0011-agui-is-an-inbound-transport, 0010-agents-deploy-as-containers, 0004-persist-then-broadcast, 0005-bots-are-real-users]
rules: []
---

# ADR 0012: An agent with no address may dial in and hold the connection

## Context
[[0011-agui-is-an-inbound-transport]] settled that **Blob is the AG-UI client and the
agent is the server**, and the reasoning still holds: every framework ships an AG-UI
server, none ships a client that pushes into somebody else's inbox, and being the client
is what makes "your existing agent already works" true.

It assumes the agent has an address. `external` means "here is a URL, call it";
[[0010-agents-deploy-as-containers]] means "here is a repository, and the runner will
produce a URL". Both assume something Blob can route to.

The case people keep asking for has no address at all: the agent runs on their own
machine. No public hostname, no certificate, no route in through their router. Every
answer that keeps Blob dialling requires the operator to run something else forever — a
Cloudflare tunnel, ngrok, a port forward — and to keep it running for the agent to stay
reachable. For a self-hosted product whose point is that the deployment a team runs is the
whole product, "install a second network product first" is a bad first step.

## Decision
A fourth runtime, `socket`. The agent opens a WebSocket to `/ws/agent`, authenticates
with its bot token, and holds it. Runs are written down that connection and its AG-UI
events come back up.

**This reverses who dials, and nothing else.** The agent still answers runs it did not
initiate; Blob still drives; the events are the same AG-UI events, folded by the same
`Fold` over the same rules. `plugins/agui.py` is a pure function of events precisely so a
second transport costs a reader and no semantics. 0011 is qualified, not overturned: it is
a decision about *who is the client of the protocol*, and Blob still is.

**A socket agent declares no URL, and one is refused.** Two answers to "where is it" is
worse than one, and the live connection is authoritative.

**Connecting is registering.** An admin registers the agent in the console and gets a
token; the agent announces its name, description and version when it connects. That is
the whole of "importing" a desktop agent — it says what it is rather than being described
by hand in a console it has never heard of.

**What it may do is not self-declared.** `hello` carries identity, never scopes. An agent
that could widen its own grants by asserting them on connect would make the consent
screen decorative; scope changes go through the same `needs_review` path an app update
does.

**Liveness lives in Redis, not in a column.** A TTL key the holder refreshes. A row
saying "connected" outlives the process that wrote it and then lies; a key that stops
being refreshed stops existing.

## Consequences
- **The process holding the socket is not the process running the job.** Mentions are
  handled by the arq worker; sockets are held by an API process. Every run therefore
  crosses processes through Redis, the same way `realtime/hub.py` does it, and a second
  container still needs no code change.
- **Pub/sub is fan-out, so a run can reach two holders.** An agent reconnecting to a
  second process while the first still believes it has the socket would otherwise be
  asked twice and answer twice. The holder claims the run id with `SET NX` before writing
  anything — the same claim `jobs/agui.py` already takes on a message.
- **Subscribing happens before publishing.** An agent can answer in single-digit
  milliseconds; publishing first sends the opening events to a channel nobody is
  listening on, and the run then appears to hang and time out having actually succeeded.
- **No signature on a socket run, deliberately.** An HMAC proves to the *agent* that a
  request came from Blob, which matters when anyone can POST to its URL. This agent
  authenticated when it dialled in, and the connection it holds is the proof.
- **The token is not accepted as a query parameter.** `?token=` is the third thing every
  client library supports and the first thing every reverse proxy writes to an access
  log. Header, or a first frame for clients that cannot set one.
- An agent that is not connected degrades to an apology in the channel rather than to
  silence. The person asked something and is owed an answer, even if it is "not now".
- The trust model is unchanged from [[0005-bots-are-real-users]]: the bot is a real user
  row, `assert_channel_access` runs against it, and private channels stay private with no
  new code. A socket adds a transport, never a capability — which is the same sentence
  0011 ends on, and it is still the test.
