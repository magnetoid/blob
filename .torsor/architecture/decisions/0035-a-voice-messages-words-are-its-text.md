---
type: decision
status: accepted
tags: [adr, messages, voice, agents, search]
links:
  [
    0011-agui-is-an-inbound-transport,
    0013-agent-chains-carry-human-authority,
    0026-an-agent-may-follow-a-channel-and-hear-what-was-not-addressed-to-it,
    0019-blob-ships-no-agent-of-its-own,
  ]
rules: []
---

# ADR 0035: A voice message's words are its text

## Context

Migration 0038 let a recording be its own kind of attachment, with a length and a
waveform, and nothing more: no recorder, no player, no words. A recording nobody can
search, preview in a notification or hand to an agent is a dead end in a product whose
agents read the conversation. Slack transcribes clips and shows the words beside them;
the open question was where those words live and who waits for them.

## Decision

**A recording sent on its own gets its words from a speech service, and those words become
the message's body.**

- **The body, not a column beside it.** Search's generated tsvector, the push preview, the
  thread summary and an agent's input all read `messages.body` already; a `transcript`
  column would have needed teaching to each of them and would have drifted from at least
  one. `set_transcript` fills only a body still empty — somebody may have edited it in the
  meantime — and leaves `edited_at` alone, because Blob wrote it, not the author.
  `attachments.transcript_status` (`none | pending | done | failed`) and
  `transcript_provider` (`stt:<model>`) say whose words they are, the way
  `thread_summaries.provider` does. A recording sent with words typed beside it is not
  transcribed: the author already said what they meant in text.
- **One endpoint every speech service speaks.** `lib/stt.py` posts to OpenAI's
  `/v1/audio/transcriptions` and nothing else, so OpenAI's models and the self-hosted ones
  (Speaches, LocalAI, vLLM) are the same configuration, and a team that keeps its voices
  on its own network loses nothing. Like `lib/llm.py` it is not a framework, and unset it
  is honest: the client is told (`transcriptionEnabled`) and promises no words.
- **A run waits for the words.** A recording has nothing for an agent to read until the
  `transcribe` job writes them, so `announce` holds back the run it would have started,
  and the job starts it — the same run, on the same person's authority (ADR 0013), with
  the words as its text. A spoken `@name` is not a mention: nobody picked it from a list.
- **The agent whose DM it is always hears it; a follower only hears words.** With no
  speech service, or a transcript that failed, the DM's agent still gets a run, and its
  input names the recording — `[attached: voice message 0:42 (not transcribed)]` — so it
  can ask for it typed instead of seeming to ignore it. A follower nobody addressed (ADR
  0026) is not woken for words that are not there. The audio itself is never handed to an
  agent: AG-UI's content parts could carry it, but the transcript is what every agent can
  read, and Blob builds at the contract every agent speaks rather than for one that
  listens (ADR 0019).

## Consequences

- The recorder prefers WebM/Opus and falls back to MP4 for Safari; the waveform is measured
  while recording (64 peaks from an `AnalyserNode`), so drawing a voice message costs no
  download, and its audio is fetched only on play.
- A guest's recording starts no run, like anything a guest sends (ADR 0034).
- Not built: transcripts in more than one language at once, a speaker's own correction of
  the words other than editing the message, the audio as an AG-UI part for agents that
  can listen, and transcribing a recording sent with typed words.
