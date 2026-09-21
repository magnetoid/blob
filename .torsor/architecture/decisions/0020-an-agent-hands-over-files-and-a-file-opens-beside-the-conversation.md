---
type: decision
status: accepted
tags: [adr, agents, files, security, client]
links:
  [
    0007-user-content-is-data-never-code,
    0011-agui-is-an-inbound-transport,
    0012-agents-may-dial-in,
    0014-work-channels-and-sandboxed-artifacts,
    0019-blob-ships-no-agent-of-its-own,
  ]
rules: []
---

# An agent hands over a file inside the run it is answering, and a file opens beside the conversation

## Context

Asked for a web page, Janus built one and answered *"File: /opt/data/hadley/index.html — a
single self-contained HTML file."* The channel got the sentence and nothing else. The file
was on Janus's own disk; nothing in the run carried it, and Blob had no way to receive
one: the bot API had no upload route (`files:write` was declared and unused), and the one
thing an agent could hand over — a `blob.artifact` ([[0014]]) — was text, and inert
outside a work channel. Even a person could not share an `.html`: it was refused by name,
and its bytes were refused by the type check. And a file that did arrive could only be
downloaded; nothing showed one.

Janus already delivers files to Telegram, Slack and a dozen other platforms — a reply that
carries `MEDIA:/path` or a bare path to a file becomes a native attachment. Its Blob
connectors had just never implemented the delivering half.

## Decision

**A file travels inside the run, as three `CUSTOM` events.** `blob.file.start`
`{id, name, mimeType?, size?}`, then `blob.file.chunk` `{id, data}` with base64 pieces,
then `blob.file.end` `{id}` — the protocol's own triad for text
(`TEXT_MESSAGE_START`/`CONTENT`/`END`), so an agent author has seen the shape. AG-UI has no
standard for output files (its multimodal parts are *input*), and `CUSTOM` is the
extension point it provides. Base64 pieces over a JSON event stream are how realtime APIs
already carry audio. Keep a piece under 256 KiB so a socket frame (512 KiB) holds it.

The alternatives were worse for the agent that matters. An upload through the bot API
needs a credential, and the Janus seeded beside Blob ([[0019]]) holds none — Blob calls it,
never the reverse. Blob fetching the file from a URL the agent names needs an address, and
an agent that dials in ([[0012]]) has none; it would also point Blob's fetcher at a URL an
agent chose. In the stream, one mechanism serves both transports and needs nothing but the
connection the run already is.

**What a file meets on the way in is what a person's upload meets.** The same name check,
the same byte sniffing, the workspace's own upload limit, a thumbnail for an image, and the
same order — the row before the object, so a failure between them leaves a row the orphan
sweep can find (`services/agent_files.py`). The run's `Fold` holds the pieces, so the worker
bounds them: ten files and `AGUI_MAX_FILE_BYTES` (25 MiB) per run, and the stream's read
budget grows by exactly that allowance in base64.

**A file rides on the answer.** On the message the run seals next, or — nothing is written
until the stream ends — on the one it sealed last. Only a run that says nothing at all gets
a message holding just its files.

**Nothing about a file is silent.** A file refused, damaged, over a limit, unfinished, or
lost to storage becomes a line under the answer: *Couldn't attach `setup.exe`: .exe files
can't be shared here.* The failure this ADR exists for was an absence, and an absence is
the one thing nobody in a channel can diagnose.

**An HTML page and an SVG may be shared — by anybody.** They were refused because nothing
could show them safely, and the refusal was of the file rather than of the danger. Storage
serves every type that is not an allowlisted image as an `application/octet-stream`
download ([[0007]]'s rule for storage, unchanged), so neither is ever rendered as this
origin. The type check still refuses the disguise it was written for — HTML claiming to be
a PNG — and an executable under any name.

**A file opens beside the conversation.** Clicking a file opens it in the right-hand column
the thread panel uses — one thing at a time there, the shape of Slack's Work Objects
flexpane — and Download stays in its header and on the card whatever happens. What it
draws comes from three places:

- *Text*, from `GET /api/attachments/{id}/preview`, which sends every kind of text as
  `text/plain` under `default-src 'none'; sandbox`. The client decides what the text is: a
  document through the message renderer (now with headings — documents only), a table, JSON
  or code as text, an SVG in a `srcdoc` frame with scripts off.
- *A PDF*, streamed inline from the same URL for the browser's own viewer, framable by this
  origin only.
- *A web page*, from `GET /api/attachments/{id}/page`, served as itself under a header
  policy the page cannot edit: `sandbox allow-scripts` (so an opaque origin however the URL
  is opened, framed or directly), no network, framed by this origin only.

A page is not drawn into `srcdoc` because a `srcdoc` document **inherits the policy of the
page that frames it**, and the app's `script-src 'self'` refuses every inline script a page
has — measured in Chrome, not assumed. Unlike a work channel's preview ([[0014]]), a page
here runs when its panel opens: the person clicked that file, which is the asking; nothing
runs because a message scrolled past.

## Alternatives considered

- **Upload through the bot API** (`files.getUploadURLExternal`, Slack's current shape). The
  right answer for an app that holds a token, and still available to add for one; wrong as
  the answer for an agent that holds none.
- **Extend `blob.artifact` to every channel.** Text only, 200 KiB, and no download — a PDF
  or a spreadsheet would still not reach anybody.
- **Render a page with `srcdoc` and relax the app's policy.** Inheritance only tightens;
  the relaxation would have to be `script-src 'unsafe-inline'` for the whole app.
- **Serve previews by redirecting to storage.** Storage cannot be told to send a policy or
  a framing rule, and a managed bucket's CORS and headers are the operator's, not ours.

## Consequences

- Preview bytes pass through the API process — text up to 2 MiB, a PDF streamed a chunk at
  a time. Downloads remain a redirect to storage. A `preview` rate-limit bucket covers both
  routes; two new error codes, `no_preview` and `preview_too_large`.
- `framedDocument` now writes the preview policy before anything the page wrote, where a
  page cannot steer it into a comment.
- **Known gap:** a work channel's HTML artifact still runs in `srcdoc`, so in production its
  inline scripts are refused by the inherited policy. The fix is the same shape as
  `/page` — the artifact served from its own URL under its own policy.
- Janus delivers files by emitting these events from its AG-UI and socket connectors,
  reusing the `MEDIA:` extraction and path safety rules it applies on every other platform.
