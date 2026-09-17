/** Which plugin row is the agent Blob seeds.
 *
 * The client's copy of `services/janus_agent.SEEDED_AGENT`, and it has to stay the same
 * question: the two routes the Janus page writes through refuse anything else, and the
 * run job stops forwarding the workspace's instructions the moment a row stops matching.
 * Asked in three places — the page, the row it finds, and the Apps list's Configure —
 * so it lives here rather than as three spellings of the same `&&`.
 *
 * The name is not part of it. An admin may rename the bot, and a row somebody installed
 * by hand may call itself Janus; neither changes who the workspace's resident agent is.
 */

import type { AdminPlugin } from "../../../../lib/api.ts";

export function isSeededJanus(plugin: AdminPlugin): boolean {
  return (
    plugin.slug === "janus" && plugin.runtime === "external" && !plugin.ownerUserId
  );
}

/**
 * The row the Janus page is about: the seeded one, or failing that whatever else in
 * this workspace wears the slug.
 *
 * The fallback is deliberate. A row that is Janus by name but not by identity — owned
 * by a person, or dialling in over a socket — is exactly the case where an admin needs
 * to be told *why* the workspace's controls are inert, and sending them to a setup page
 * that says "install Janus" while Janus is right there answering would be a lie.
 */
export function janusRowOf(plugins: AdminPlugin[]): AdminPlugin | null {
  return (
    plugins.find(isSeededJanus) ?? plugins.find((row) => row.slug === "janus") ?? null
  );
}
