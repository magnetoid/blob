# 0016 — An assistant reaching in is a person, not a bot

**Status:** accepted, 2026-09-06. Builds on 0005 (a bot is a real user), 0008 (one image,
one origin), 0011 (AG-UI is an inbound transport). Qualifies 0005 by carving out the one
caller that is deliberately *not* given a bot row.

## Context

Blob already answers two callers. A person carries a session cookie; an app carries a bot
token and acts as its own `users` row (0005). Both assume the caller is inside the product:
the browser, or an integration a workspace admin installed.

2026 made a third caller ordinary. Slack shipped its MCP server in February and saw tool
calls grow twenty-five-fold in four months; the protocol's `2026-07-28` revision dropped
sessions entirely, which turns a remote MCP server into a plain HTTP workload. The people
using Blob already have an assistant open in a terminal or a browser tab all day. What they
cannot do is ask it "what did I miss in #ops?" — the workspace is a wall away from the tool
they are already talking to.

The prior planning docs proposed this as "MCP both ways", bundled with making the built-in
agent an MCP *client*. That second half is a separate decision and is not taken here.

## Decisions

**1. The token resolves to a user, and there is no bot.** `mcp_tokens` points at a `users`
row and the caller *is* that person: every tool call runs through the same
`assert_channel_access` a browser tab runs. This is the deliberate exception to 0005. A bot
row would have meant inviting the assistant into channels, showing it in the member list,
and keeping a second answer to "what can it see?" in step with the first — three problems
in exchange for nothing, since the assistant has no independent identity to express. The
consequence is the property that makes the feature safe to hand out: whatever its owner can
see it can see, no more, and every removal is inherited. Leave a channel and it leaves;
deactivate the person and every assistant they connected goes silent in the same instant.

**2. Read is the token; write is a second decision.** `scopes` is `{read}` or
`{read,write}` and a CHECK constraint says so. The catalogue is filtered by scope before
`tools/list` answers, not only before a call runs — a model shown a tool it cannot use will
propose it, and the person then reads a permission error from inside their assistant that
they cannot act on there. A write posts as the person, under their name, in front of their
colleagues; that is worth a tick, not a default.

**3. The endpoint is dual-era, and stateless in both.** `POST /api/mcp` answers both the
`initialize` handshake of `2025-06-18`/`2025-11-25` and the per-request `_meta` of
`2026-07-28`, choosing by what the request carries rather than by what it asks for. No
`Mcp-Session-Id` is ever minted, so every request stands alone — which is what lets a
second container answer and a restart cost nothing. `GET` and `DELETE` answer 405: the old
transport's server-push stream and session teardown are not hosted, and 405 is what tells a
client the endpoint is there and the verb is not.

The modern era's header mirroring is enforced rather than ignored: `Mcp-Method` and
`Mcp-Name` are compared against the body (decoding the `=?base64?…?=` sentinel first) and a
mismatch is `-32020`. The point of that rule is that a proxy routing on the header and a
server executing the body must not be able to disagree, and a server that accepts the
header without checking it is the half that makes the guarantee worthless.

**4. Tools answer in prose, with ids.** No `outputSchema`, no `structuredContent`. A model
reads a numbered transcript better than a nested object, and a declared output schema is a
promise to conform to it for ever. Every line carries the id it is about, so the next call
has something to name. A refusal — no such channel, rate limit spent, read-only token — is
an MCP *tool* error (`isError: true`), never a JSON-RPC error: a working tool saying no must
not read to the client as a broken connection.

**5. A write goes through `send` and `announce`, like every other write.** Not a second
path into `messages`. The scheduled sweep already taught this lesson once by storing rows
and announcing nothing — no socket frame, no badge, no unfurl, no agent run. A write spends
the same `send_message` bucket a browser tab spends, on top of the `mcp_tool` bucket every
call spends; both are keyed by the *person*, so minting a second connection buys no second
allowance.

## Consequences

An assistant is now a first-class reader of a workspace with no new deployment: one image,
one origin, one more route (0008 holds). Authentication is a bearer token rather than
OAuth 2.1 — every client that accepts a custom header works today, and a client that
insists on a discovery-and-consent flow does not. That is the known gap, and it is where
this goes next if demand appears.

No CORS, deliberately. `SessionMiddleware` refuses a cross-origin POST and nothing here
exempts `/api/mcp` from that, so a client that connects *from a browser tab* cannot reach
it. The clients this is for — Claude Code, and the remote-connector fetches Anthropic's and
OpenAI's servers make on a user's behalf — are server-side and send no `Origin` at all.
Opening it later is three changes (a public `OPTIONS`, an Origin exemption, the response
headers) and would be safe, because the token never rides along automatically the way a
cookie does; it is left closed until something actually needs it.

The `mcp_tokens.user_id` cascade is deliberate: a token with no owner has no permissions to
derive and would be a credential nobody could see in order to revoke it.

Nothing here makes Blob an MCP *client*. The built-in agent still has no tools; mounting
external MCP servers as tools for it is a separate decision with a different blast radius.
