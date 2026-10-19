/** The channels an agent follows (ADR 0026), one switch per channel it is in.
 *
 * Following is the one way an agent is sent what was not addressed to it, so the page
 * says plainly what the switch does before anyone presses it: every message a person
 * posts there reaches the agent, which can stay quiet; it can only look, never post
 * through Blob's tools; it shows the channel nothing while it thinks; and it is held to
 * a cooldown and a daily cap. Only channels the agent is already in are offered —
 * following is not joining, and the Channels card above is where it joins.
 */

import { useState } from "react";
import { api, type AppChannel } from "../../../../lib/api.ts";
import { useFetch } from "../../../../lib/useFetch.ts";

export function AgentFollows({
  pluginId,
  agentName,
  channels,
  act,
}: {
  pluginId: string;
  agentName: string;
  channels: AppChannel[];
  act: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const { data: loaded } = useFetch(
    async () => new Set((await api.admin.agentFollows(pluginId)).channels.map((c) => c.id)),
    [pluginId],
  );
  // What the server last said, once anything has been changed here.
  const [changed, setChanged] = useState<Set<string> | null>(null);
  const following = changed ?? loaded;
  const joined = channels.filter((channel) => channel.joined);

  function toggle(channel: AppChannel) {
    void act(async () => {
      const { channels: now } = following?.has(channel.id)
        ? await api.admin.unfollowChannel(pluginId, channel.id)
        : await api.admin.followChannel(pluginId, channel.id);
      setChanged(new Set(now.map((c) => c.id)));
    });
  }

  return (
    <>
      <div className="pref-hint">
        A channel {agentName} follows sends it every message people post there, not only the
        ones that mention it — told it was not addressed, so it can stay quiet unless it has
        something to add. It can look around but not post through Blob&apos;s tools, it shows
        the channel nothing while it thinks, and it hears at most one message every two
        minutes and forty a day in each channel. Switch it on only for an agent built to keep
        quiet.
      </div>
      {joined.length === 0 && (
        <div className="pref-hint">It is in no channel yet. Add it to one above first.</div>
      )}
      {joined.map((channel) => {
        const on = following?.has(channel.id) ?? false;
        return (
          <div className="pref-row" key={channel.id}>
            <div className="grow min-0">
              <div className="pref-label">#{channel.name ?? channel.id}</div>
            </div>
            <button
              className="toggle"
              aria-pressed={on}
              aria-label={`${agentName} follows #${channel.name ?? channel.id}`}
              disabled={following === null}
              onClick={() => toggle(channel)}
            >
              <span />
            </button>
          </div>
        );
      })}
    </>
  );
}
