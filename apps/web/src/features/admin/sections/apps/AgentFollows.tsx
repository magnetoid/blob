/** The channels an agent follows (ADR 0026), one switch per channel it is in, and what
 * it hears there.
 *
 * Following is the one way an agent is sent what was not addressed to it, so the page
 * says plainly what the switch does before anyone presses it: what a person posts there
 * reaches the agent, which can stay quiet; it can only look, never post through Blob's
 * tools; it shows the channel nothing while it thinks; and it is held to a cooldown and a
 * daily cap. Only channels the agent is already in are offered — following is not
 * joining, and the Channels card above is where it joins. What it hears (M4) narrows a
 * followed channel to messages with files, or to the questions nobody answered.
 */

import { useState } from "react";
import {
  api,
  type AppChannel,
  type FollowedChannel,
  type FollowHears,
} from "../../../../lib/api.ts";
import { useFetch } from "../../../../lib/useFetch.ts";

/** What a followed channel can send the agent, as one choice. */
const HEARING: readonly { value: string; label: string }[] = [
  { value: "everything", label: "Every message" },
  { value: "files", label: "Messages with files" },
  { value: "unanswered:30", label: "Questions unanswered for half an hour" },
  { value: "unanswered:60", label: "Questions unanswered for an hour" },
  { value: "unanswered:240", label: "Questions unanswered for four hours" },
  { value: "unanswered:1440", label: "Questions unanswered for a day" },
];

function hearingOf(follow: FollowedChannel): string {
  return follow.hears === "unanswered" ? `unanswered:${follow.quietMinutes ?? 60}` : follow.hears;
}

function hearingFrom(value: string): { hears: FollowHears; quietMinutes?: number } {
  if (value.startsWith("unanswered:")) {
    return { hears: "unanswered", quietMinutes: Number(value.slice("unanswered:".length)) };
  }
  return { hears: value as FollowHears };
}

function byId(channels: FollowedChannel[]): Map<string, FollowedChannel> {
  return new Map(channels.map((channel) => [channel.id, channel]));
}

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
    async () => byId((await api.admin.agentFollows(pluginId)).channels),
    [pluginId],
  );
  // What the server last said, once anything has been changed here.
  const [changed, setChanged] = useState<Map<string, FollowedChannel> | null>(null);
  const following = changed ?? loaded;
  const joined = channels.filter((channel) => channel.joined);

  function toggle(channel: AppChannel) {
    void act(async () => {
      const { channels: now } = following?.has(channel.id)
        ? await api.admin.unfollowChannel(pluginId, channel.id)
        : await api.admin.followChannel(pluginId, channel.id);
      setChanged(byId(now));
    });
  }

  function hear(channel: AppChannel, value: string) {
    void act(async () => {
      const { channels: now } = await api.admin.followChannel(
        pluginId,
        channel.id,
        hearingFrom(value),
      );
      setChanged(byId(now));
    });
  }

  return (
    <>
      <div className="pref-hint">
        A channel {agentName} follows sends it what people post there, not only what mentions
        it — told it was not addressed, so it can stay quiet unless it has something to add.
        Choose what it hears: every message, only messages with files, or only the questions
        nobody answered in time, which it answers in their thread. It can look around but not
        post through Blob&apos;s tools, it shows the channel nothing while it thinks, and it
        hears at most one message every two minutes and forty a day in each channel. Switch
        it on only for an agent built to keep quiet.
      </div>
      {joined.length === 0 && (
        <div className="pref-hint">It is in no channel yet. Add it to one above first.</div>
      )}
      {joined.map((channel) => {
        const follow = following?.get(channel.id);
        const on = follow !== undefined;
        const where = `#${channel.name ?? channel.id}`;
        return (
          <div className="pref-row" key={channel.id}>
            <div className="grow min-0">
              <div className="pref-label">{where}</div>
            </div>
            {follow && (
              <select
                className="input"
                aria-label={`What ${agentName} hears in ${where}`}
                value={hearingOf(follow)}
                onChange={(event) => hear(channel, event.target.value)}
              >
                {HEARING.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <button
              className="toggle"
              aria-pressed={on}
              aria-label={`${agentName} follows ${where}`}
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
