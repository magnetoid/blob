---
type: decision
status: accepted
tags: [adr, messages, polls, privacy]
links:
  [
    0035-a-voice-messages-words-are-its-text,
    0038-an-export-takes-what-its-asker-may-take,
  ]
rules: []
---

# ADR 0041: A poll is a message, and its votes are public unless it says they are not

## Context

Teams that move from Slack bring a habit Slack never shipped itself — `/poll` from Polly or
Simple Poll — and Teams and Mattermost answer it in the product. The plan of 2026-10-18
(B3) named polls and left the shape open. Two questions decide it: what a poll *is* to the
rest of Blob, and who may see who voted for what.

## Decision

**A poll is an ordinary message whose text is the question, with its options and votes
beside it. Who voted for what is visible to the conversation, like a reaction — unless the
poll was made anonymous, in which case nobody sees it, the author and admins included.**

- **A message first.** The question is the message's body, so search, notifications, push
  previews, summaries, exports and an agent's input read it with nothing new to learn — the
  rule ADR 0035 set for a voice message's words. A `polls` row keyed by the message holds
  the options (two to ten), whether several may be chosen, and whether it is anonymous; a
  `poll_votes` row is one person's choice of one option. Deleting the message takes the
  poll with it.
- **Wherever a message may be posted, by whoever may post it.** Votes come from people who
  may read the conversation — a private channel's poll is 404 to anybody else, as the
  channel is — and an archived conversation's poll takes no more votes.
- **Public by default, like a reaction.** A vote is a public act in the room, the same as
  pressing 👍, and showing names is what keeps a poll honest. **Anonymous** is a choice made
  when it is created and never changed after: the counts are served, the names never are —
  not to the author, not to an admin, not in an export. The rows still say who voted, so
  nobody votes twice; nothing reads them back.
- **A vote can change until the poll closes.** Choosing again replaces your choice;
  choosing nothing withdraws it. The author or an admin closes a poll, and a closed poll
  shows its result and takes no votes.
- **The question does not change under the votes.** A poll's message cannot be edited:
  rewording a question people have already answered changes what they answered.
- **Live, with nothing new on the wire.** A vote broadcasts the message again as
  `message.updated` once it commits (persist, then broadcast): its `poll` is the same for
  every reader — counts, and the voters unless it is anonymous — so one frame serves the
  room. An anonymous poll's own choice is the one thing that differs per reader, and the
  card asks for it (`GET /api/messages/{id}/poll`).

**Not built:** a closing time, polls from apps' blocks, and an agent being handed the options
(it reads the question).

## Consequences

- Migration adds `polls` and `poll_votes`; `services/polls.py` holds the rules; the message
  serialiser carries `poll` — options, counts and, for a public poll, who chose what — from
  the same statement that carries reactions.
