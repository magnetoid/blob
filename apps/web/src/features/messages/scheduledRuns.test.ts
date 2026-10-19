/** Which scheduled messages are runs: the label the Scheduled list puts on them. */

import { describe, expect, it } from "vitest";
import type { User } from "@blob/shared";
import type { WorkspaceAgent } from "../../lib/api.ts";
import { agentsSetGoing } from "./scheduledRuns.ts";

function user(id: string, displayName: string, overrides: Partial<User> = {}): User {
  return {
    id,
    kind: "human",
    displayName,
    fullName: null,
    title: null,
    avatarUrl: null,
    timezone: "UTC",
    role: "member",
    statusEmoji: null,
    statusText: null,
    statusExpiresAt: null,
    deactivated: false,
    agentDisabled: false,
    agentResident: false,
    ...overrides,
  };
}

const users: Record<string, User> = {
  me: user("me", "Ana"),
  janus: user("janus", "Janus", { kind: "bot", agentResident: true }),
  scout: user("scout", "Scout", { kind: "bot" }),
  mine: user("mine", "Pip", { kind: "bot" }),
  lent: user("lent", "Lent", { kind: "bot" }),
  lee: user("lee", "Janus Lee"),
};

function agent(botUserId: string, mine = false): WorkspaceAgent {
  return {
    id: `p-${botUserId}`,
    name: botUserId,
    botUserId,
    mine,
    lent: false,
    description: null,
    online: null,
  };
}

/** Janus is the workspace's, Pip is Ana's own, Lent is somebody's lent to her; Scout is
 *  somebody else's and not hers to set going. */
const agents = [agent("janus"), agent("mine", true), agent("lent")];
const channel = { kind: "public" as const, memberIds: null };
const names = (found: User[]) => found.map((u) => u.displayName);

describe("which scheduled messages are runs", () => {
  it("names the agents a message mentions that you may set going", () => {
    expect(names(agentsSetGoing("@Janus post the standup prompt", channel, users, agents, "me"))).toEqual([
      "Janus",
    ]);
  });

  it("leaves out an agent you may not set going, and a message that names nobody", () => {
    expect(agentsSetGoing("@Scout what changed?", channel, users, agents, "me")).toEqual([]);
    expect(agentsSetGoing("Standup in five", channel, users, agents, "me")).toEqual([]);
  });

  it("reads a longer name as the person it is, not the agent it starts with", () => {
    expect(agentsSetGoing("@Janus Lee can you cover?", channel, users, agents, "me")).toEqual([]);
  });

  it("counts the agent a DM is with when it answers its room without a mention", () => {
    const dm = (other: string) => ({ kind: "dm" as const, memberIds: ["me", other] });
    expect(names(agentsSetGoing("standup", dm("janus"), users, agents, "me"))).toEqual(["Janus"]);
    expect(names(agentsSetGoing("standup", dm("mine"), users, agents, "me"))).toEqual(["Pip"]);
    // Lent to you, not yours: in a DM it still needs a mention.
    expect(agentsSetGoing("standup", dm("lent"), users, agents, "me")).toEqual([]);
  });
});
