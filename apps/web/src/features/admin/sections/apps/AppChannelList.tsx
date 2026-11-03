/** Where an agent can speak, one join at a time.
 *
 * The load-bearing control on both pages that show it: an installed app is inert until
 * its bot is a member somewhere, and an app that answers over AG-UI never calls Blob on
 * its own, so it cannot join for itself the way a webhook app can. Shared rather than
 * copied because the Janus page asks exactly the same question of the same three routes.
 */

import { api, type AppChannel } from "../../../../lib/api.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { ItemActions, ItemContent, ItemTitle } from "../../../../components/ui/item.tsx";
import { CardNotice, CardRow, CardRows } from "../../../console/Card.tsx";

export function AppChannelList({
  pluginId,
  channels,
  act,
  /** Who the empty line is about. "This app" is wrong on a page about one named agent. */
  subject = "This app",
}: {
  pluginId: string;
  channels: AppChannel[];
  act: (run: () => Promise<unknown>) => Promise<void>;
  subject?: string;
}) {
  const joined = channels.filter((channel) => channel.joined);
  // A fragment: the rows are the enclosing card's own, so they take its rules between
  // rows rather than a column of their own.
  return (
    <>
      <p className="m-0 max-w-[68ch] text-sm text-pretty text-muted-foreground">
        {joined.length === 0
          ? `${subject} is not in any channel yet, so nobody can reach it. Add it to one.`
          : `Mentioning it in ${
              joined.length === 1 ? "this channel" : "these channels"
            } will reach it.`}
      </p>
      {channels.length === 0 ? (
        <CardNotice>There are no public channels to add it to.</CardNotice>
      ) : (
        <CardRows aria-label="Channels">
          {channels.map((channel) => {
            const where = `#${channel.name ?? channel.id}`;
            return (
              <CardRow key={channel.id}>
                <ItemContent>
                  <ItemTitle>{where}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant={channel.joined ? "ghost" : "outline"}
                    aria-label={`${channel.joined ? "Remove" : "Add"} ${where}`}
                    onClick={() =>
                      void act(() =>
                        channel.joined
                          ? api.admin.appLeaveChannel(pluginId, channel.id)
                          : api.admin.appJoinChannel(pluginId, channel.id),
                      )
                    }
                  >
                    {channel.joined ? "Remove" : "Add"}
                  </Button>
                </ItemActions>
              </CardRow>
            );
          })}
        </CardRows>
      )}
    </>
  );
}
