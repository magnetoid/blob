/** `api.agents` — see `lib/api.ts` for the assembled client. */

import { get, post, patch, del } from "./client.ts";

/** One row of the usage page (M2 · A9): an agent, a person, or one of Blob's own
 * features (`catchup`, `summary`, with a null id). */
export interface UsageLine {
  id: string | null;
  name: string;
  /** Whose agent it is, for one somebody owns. */
  ownerName: string | null;
  /** Runs — or, for Blob's own features, calls. */
  runs: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  /** In the workspace's currency; null when nothing could be priced. */
  cost: number | null;
  /** False when some tokens had no price. */
  costComplete: boolean;
}

/** A model seen in the window, and its price per million tokens if one was set. */
export interface UsageModel {
  model: string;
  tokens: number;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
}

export interface UsageReport {
  days: number;
  currency: string | null;
  agents: UsageLine[];
  people: UsageLine[];
  blob: UsageLine[];
  models: UsageModel[];
}

/** A note an agent kept (M2 · A8) — words, so a person can reword one as well as forget
 * it. A person's own, in Settings; a conversation's, on the agent's page for an admin. */
export interface AgentNote {
  id: string;
  pluginId: string;
  agentName: string;
  channelId: string;
  channelName: string | null;
  channelKind: string;
  body: string;
  updatedAt: string;
}

/** What an agent remembers of one conversation (migration 0050): a person's own memory
 * with an agent they own or borrow, or — for an admin — a conversation's. */
export interface AgentMemory {
  id: string;
  pluginId: string;
  agentName: string;
  channelId: string;
  channelName: string | null;
  channelKind: string;
  /** Remembered of a thread rather than of the channel as a whole. */
  inThread: boolean;
  updatedAt: string;
  /** Bytes of JSON as stored. */
  size: number;
  /** The start of it, as JSON text. */
  preview: string;
}

/** One live loan of your agent — what `/allow` made. */
export interface AgentLoan {
  id: string;
  granteeUserId: string;
  granteeName: string;
  /** Null for a loan that covers everywhere the agent is. */
  channelId: string | null;
  channelName: string | null;
  grantedAt: string;
}

export interface MyAgent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  /** Holding its connection right now. */
  online: boolean;
  botUserId: string | null;
  createdAt: string;
}

/** An agent a member may bring into a piece of work: the workspace's, or their own. */
export interface WorkspaceAgent {
  id: string;
  name: string;
  botUserId: string;
  /** Yours: you own it. One somebody lent you is listed, and is not yours. */
  mine: boolean;
  /** Somebody else's own agent, listed because they lent it to you everywhere. */
  lent: boolean;
  /** What it says it does — its manifest's description — or null. */
  description: string | null;
  online: boolean | null;
}

interface AttachedAgent {
  agent: MyAgent;
  /** Shown once: what the bridge dials in with, and what it signs runs with. */
  botToken: string;
  signingSecret: string;
}

export interface AppChannel {
  id: string;
  name: string | null;
  kind: string;
  joined: boolean;
}

export const agents = {
  /** Which agent `/cli` would open a terminal into, or a typed refusal saying why
   *  there isn't one (`not_hosted` for an agent Blob does not host). */
  terminalTarget: (userId: string) =>
    get<{ pluginId: string; agentName: string }>(
      `/api/agents/terminal/${userId}`,
    ),
  /** The agents you may bring into a piece of work. */
  list: () => get<{ agents: WorkspaceAgent[] }>("/api/agents"),
  /** Your own agents: attached by you, owned by you, answering only you. */
  mine: () => get<{ agents: MyAgent[] }>("/api/agents/mine"),
  /** What your own agents spent, whoever asked them (M2 · A9). */
  usage: (days: 1 | 7 | 30 = 7) =>
    get<UsageReport>(`/api/agents/usage?days=${days}`),
  attach: (name: string) => post<AttachedAgent>("/api/agents/mine", { name }),
  detach: (agentId: string) => del<{ ok: true }>(`/api/agents/mine/${agentId}`),
  /** Who your agent is lent to, and where. */
  loans: (agentId: string) =>
    get<{ loans: AgentLoan[] }>(`/api/agents/mine/${agentId}/loans`),
  endLoan: (agentId: string, loanId: string) =>
    del<{ ok: true }>(`/api/agents/mine/${agentId}/loans/${loanId}`),
  /** What agents remember of your own conversations with them. */
  memory: () => get<{ memories: AgentMemory[] }>("/api/agents/memory"),
  forgetMemory: (memoryId: string) =>
    del<{ ok: true }>(`/api/agents/memory/${memoryId}`),
  forgetAllMemory: () => del<{ ok: true }>("/api/agents/memory"),
  notes: () => get<{ notes: AgentNote[] }>("/api/agents/notes"),
  rewordNote: (noteId: string, body: string) =>
    patch<AgentNote>(`/api/agents/notes/${noteId}`, { body }),
  forgetNote: (noteId: string) => del<{ ok: true }>(`/api/agents/notes/${noteId}`),
  channels: (agentId: string) =>
    get<{ channels: AppChannel[] }>(`/api/agents/mine/${agentId}/channels`),
  joinChannel: (agentId: string, channelId: string) =>
    post<{ ok: true }>(`/api/agents/mine/${agentId}/channels/${channelId}`),
  leaveChannel: (agentId: string, channelId: string) =>
    del<{ ok: true }>(`/api/agents/mine/${agentId}/channels/${channelId}`),
};
