/**
 * "14 members · 3 agents" for the channel header.
 *
 * Its own file rather than an export from `ChannelView`: a component module that also
 * exports a plain function loses React Fast Refresh, and this is the sort of thing that
 * wants testing without standing up the whole pane anyway. Two numbers rather
 * than one total, because a workspace where some of the members are programs is what
 * this product is and a single figure hides it — and the agents half is dropped when
 * there are none, so a channel without one is never made to mention them.
 *
 * `null` while the member list is still in flight: an en dash, not a zero. Drawing 0 and
 * then 14 a moment later reads as people leaving.
 */
export function memberSummary(memberCount: number | null, agentCount: number): string {
  if (memberCount === null) return "–";
  const people = `${memberCount} ${memberCount === 1 ? "member" : "members"}`;
  if (agentCount <= 0) return people;
  return `${people} · ${agentCount} ${agentCount === 1 ? "agent" : "agents"}`;
}
