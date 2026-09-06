# 0015 — Summaries cite their sources; nudges go to the asker alone

**Status:** accepted, 2026-09-05. Builds on 0005 (a bot is a real user), 0006 (transactional
outbox), 0007 (content is data). Qualifies nothing.

## Context

Blob's thread summary was a regex — sentences that said *decided* or *please* — labelled
"AI Summary" in the panel, while `lib/llm.py` already answered mentions and wrote the
unread recap. Every 2026 team-chat product ships model summaries; the complaints about
them cluster on three things: lines that were invented, no way to check a line against
the conversation, and a summary that treats a proposal like a decision. Separately, the
one message in a channel that most needs a second look is a question nobody answered,
and nothing in Blob or Slack does anything about it beyond "remind me about this".

Both production instances run with no model configured. Whatever ships has to be honest
and useful in that state too.

## Decisions

**1. Two providers, and the row says which.** `thread_summaries.provider` is `heuristic-v1`
for the keyword scan and `llm:<model>` for the model. The scan runs when no model is
configured; it is never a silent fallback for a model that failed. A model failure is a
typed `502 llm_failed` and the previous summary stays — the person pressed Refresh
expecting the model, and a keyword scan dressed as one is a lie the panel cannot detect.
The client maps the label ("Keyword scan" / "AI summary · model") and only the model's
output carries "check the sources".

**2. Ids are resolved here, never asked of the model.** The transcript numbers every
message (`[3] Ana: …`); the model returns `sources: [3]` per line; the service maps
numbers to UUIDv7 ids. A model that cites at all — tried to, resolved or not — loses
every line it did not cite correctly: the uncited line beside cited ones, or the line
citing a number that is not there, is the one most likely invented. A model that never
cites (an OpenAI-compatible server that ignored the schema) keeps its lines uncited,
because dropping everything would be a worse summary than an uncited one; the panel
shows no arrow beside them, which is the honest signal. `open_questions` grew
from strings to `{text, messageId, askedByUserId}` for the same reason; old rows read
back as text with nothing to point at.

**3. `complete`, not `stream_reply`, for documents.** A summary has to parse as JSON, and a
stream that stops early is indistinguishable from one that finished. The non-streaming
call reads the provider's stop reason: *ran out of room* and *declined* become errors,
not fragments. `max_tokens` covers the model's thinking as well as its text on current
Anthropic models, so it is sized with real headroom (4096 for at most ~1200 tokens of
JSON — a busy thread's full summary is far more than the 300 first guessed). The
structured-output hint (`output_config.format` / `response_format`) is sent and, if the
provider answers 400 about it, dropped for one retry — servers behind `LLM_BASE_URL`
know these fields unevenly and the parser is the guarantee either way.

**4. The model call holds no transaction.** Read the thread, call the model, then store
in a short transaction with the audit row and the outbox event — the same split as
translation. A pooled connection waiting 45 seconds on a provider is how a summary
button takes the workspace down.

**5. A nudge is for the asker, and nobody else is told.** Telling the room "nobody
answered X" is a statement about everyone else's attention — a read receipt in a
different coat — and Blob does not do read receipts. Telling the asker "no answer yet" is
derivable from what they can already see. "Answered" is defined in one SQL statement from
public facts only: a live reply in the thread, a reaction from somebody else, a later
message in the channel by another *person* (an app's hourly notice is not somebody
chiming in) any time before the sweep, or any later message in the channel — thread
replies included — that mentions the asker. Nothing about who *saw* the question is
ever consulted.

**6. The nudge is a reminder in Later.** It rides `jobs/reminders.py` end to end: quiet
hours defer it, it pushes when push is set up, it shows in Later until dealt with, and it
adds no protocol surface. A reminder the person already set keeps its time and note; an
item they marked done is not resurfaced. Rejected: a bot reply in the thread (public, and
it would mark the question answered — `reply_count` is the signal being detected), a
socket event with a per-user store slice (a second delivery mechanism for the same idea),
and a toast alone (gone in six seconds).

**7. The room opts in; the person can opt out.** `channels.nudge_unanswered` is off by
default and set from Channel details by any member who can write there, because a nudge
acts on the room's conversation. `prefs.nudges` (default on) is the asker's own switch,
and muting the channel counts as switching it off. Neither `channel_members` (per-member
state would nudge or not depending on who is reading) nor `workspace_policies`
(instance-admin, about the host) is the right home.

**8. Once, and late rather than twice.** `unanswered_nudges` keyed on the message is
claimed with `INSERT … ON CONFLICT DO NOTHING RETURNING`, so two workers cannot both take
a question and a deleted reminder cannot bring it back. The sweep runs every quarter
hour, waits a day (24 h, a constant; per-channel choice is deferred), and looks back two
hours past that — a question that slips out of the window is left alone, the same stance
`jobs/scheduled.py` takes on missed slots. Time enters through a `now=` seam because the
scan is bounded by UUIDv7 id range and a rewound `created_at` does not move an id.

## Consequences

* `lib/llm.py` has three callers and two calls; its docstring says so.
* The summary route is metered (`summarize`, 10 per 5 minutes per user) only when a model
  is configured — the keyword scan never 429s.
* `ThreadSummary.openQuestions` changed shape on the wire; the client changed with it and
  apps reading `thread.summary.updated` get objects where they got strings.
* Deferred, deliberately: catch-up returning the same sections, a "Summarize N new"
  button on the unread divider, a live `thread.summary.updated` socket event, agent-
  offered answers to unanswered questions, per-channel wait times, and suggesting who
  usually answers. Each is a slice of its own; none changes the decisions above.
