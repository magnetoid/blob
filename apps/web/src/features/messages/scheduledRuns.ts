/** Which agents a scheduled message sets going when it goes out.
 *
 * A scheduled message that names an agent is a scheduled run. When it sends it is your
 * message, so it roots a chain on your authority and the agent answers it (ADR 0013) —
 * every weekday at nine, if it repeats. The Scheduled list says so, so a run you set up
 * does not read as a note to the room.
 *
 * The run's own rule, asked ahead from what the client already holds: the agents the
 * message mentions that you may set going, or — in a DM with an agent that answers its
 * room without a mention, the resident one or your own — that agent. A forecast rather
 * than a promise: an agent switched off by then does not answer.
 */

import { parseMentions, type Channel, type User } from "@blob/shared";
import type { WorkspaceAgent } from "../../lib/api.ts";
import { byDisplayName } from "../../lib/format.ts";

export function agentsSetGoing(
  body: string,
  channel: Pick<Channel, "kind" | "memberIds"> | undefined,
  users: Record<string, User>,
  agents: WorkspaceAgent[],
  me: string | null,
): User[] {
  const commandable = new Map(agents.map((agent) => [agent.botUserId, agent]));
  // Every name, people's too: the parser prefers the longest match, so leaving people out
  // would read "@Janus Lee" as a mention of Janus.
  const nameToId = new Map<string, string>();
  for (const user of Object.values(users)) {
    if (!user.deactivated) nameToId.set(user.displayName.toLowerCase(), user.id);
  }
  const ids = new Set(
    parseMentions(body, nameToId).userIds.filter((id) => commandable.has(id)),
  );

  const members = channel?.memberIds ?? null;
  if (channel?.kind === "dm" && me && members?.length === 2 && members.includes(me)) {
    const other = members.find((id) => id !== me);
    const agent = other ? commandable.get(other) : undefined;
    if (other && agent && (users[other]?.agentResident || agent.mine)) ids.add(other);
  }

  return [...ids]
    .map((id) => users[id])
    .filter((user): user is User => user !== undefined)
    .sort(byDisplayName);
}
