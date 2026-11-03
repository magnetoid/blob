/** What an agent has been asked lately, and how each attempt ended.
 *
 * Shared by the app page and the Janus page, which ask the same question of the same
 * route. `emptyLabel` is the only thing they differ on: "this app" is wrong on a page
 * about one named agent.
 *
 * Each run is a row of the card it is drawn in, and what it did and what it streamed are
 * two buttons on that row, each saying whether its panel is open. Which run a button is for
 * is part of its name, since "What it did" is on every row.
 */

import { useId, type ReactNode } from "react";
import {
  api,
  type AdminAgentRun,
  type AdminRunEvent,
} from "../../../../lib/api.ts";
import { formatTokens } from "../../../../lib/format.ts";
import { useFetch } from "../../../../lib/useFetch.ts";
import { Badge } from "../../../../components/ui/badge.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../../../../components/ui/item.tsx";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { RunWork, SeenLine } from "../../../messages/AgentRunCard.tsx";
import { CardNotice, CardRow, CardRows } from "../../../console/Card.tsx";
import { useDisclosure } from "./useDisclosure.ts";

/** What a row opens onto: a bordered, tinted panel across the row's full width. */
const PANEL = "flex basis-full flex-col gap-2 rounded-lg border bg-muted/50 p-3";

export function RunLog({
  pluginId,
  runs,
  emptyLabel = "This app has not been asked anything yet.",
}: {
  pluginId: string;
  runs: AdminAgentRun[];
  emptyLabel?: string;
}) {
  if (runs.length === 0) return <CardNotice>{emptyLabel}</CardNotice>;
  return (
    <CardRows>
      {runs.map((run) => (
        <RunRow key={run.id} pluginId={pluginId} run={run} />
      ))}
    </CardRows>
  );
}

function RunRow({ pluginId, run }: { pluginId: string; run: AdminAgentRun }) {
  const titleId = useId();
  const did = useDisclosure(titleId);
  const streamed = useDisclosure(titleId);
  const hasWork = Boolean(run.card || run.seen);
  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          <span id={titleId}>
            {run.channelName ? `#${run.channelName}` : "a channel"}
          </span>
          {/* Not muted for `interrupted`: the agent is waiting for a person, which is
              the one outcome somebody can act on, and greying it would read as
              "nothing to do". */}
          <Badge
            variant={
              run.status === "succeeded" || run.status === "interrupted"
                ? "secondary"
                : "outline"
            }
          >
            {run.status}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {run.triggerUserName ?? "someone"} asked ·{" "}
          {formatRelative(run.startedAt)}
          {run.durationMs !== null && ` · ${run.durationMs} ms`}
          {` · ${run.postCount} ${run.postCount === 1 ? "reply" : "replies"}`}
          {run.tokens !== null && ` · ${formatTokens(run.tokens)}`}
          {run.transport === "socket" && " · over its own socket"}
          {run.error && ` · ${run.error}`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {/* Opening one run: what it did and what it was shown — the plan, the tool
            calls with their arguments and results, the messages and tools it had. */}
        {hasWork && (
          <Button variant="ghost" size="sm" {...did.buttonProps}>
            What it did
          </Button>
        )}
        {/* And what the agent actually sent, for when the two above do not say why a run
            went the way it did. Fetched only when opened: it is two hundred events, and
            the log lists thirty runs. */}
        <Button variant="ghost" size="sm" {...streamed.buttonProps}>
          What it streamed
        </Button>
      </ItemActions>

      {hasWork && did.open && (
        <div id={did.panelId} className={PANEL}>
          {/* The chat's own run card, drawn by the conversation's stylesheet. */}
          <div data-legacy>
            {run.card && <RunWork card={run.card} />}
            {run.seen && <SeenLine seen={run.seen} />}
          </div>
        </div>
      )}
      {streamed.open && (
        <div id={streamed.panelId} className={PANEL}>
          <RunEvents pluginId={pluginId} runId={run.id} />
        </div>
      )}
    </CardRow>
  );
}

function RunEvents({ pluginId, runId }: { pluginId: string; runId: string }) {
  const { data, error } = useFetch(
    () => api.admin.runEvents(pluginId, runId),
    [pluginId, runId],
  );
  if (error) return <Said>Its events could not be read.</Said>;
  if (!data) return <Said>Loading…</Said>;
  if (data.hidden) {
    return (
      <Said>
        It ran in a conversation you are not in, so what it streamed is kept from
        you.
      </Said>
    );
  }
  if (data.events.length === 0) {
    return (
      <Said>
        Nothing is kept for this run: it streamed nothing, ran before events were kept,
        or was over a week ago.
      </Said>
    );
  }
  const rounds = data.events.some((entry) => entry.round > 0);
  return (
    <>
      <Said>
        {data.total > data.events.length
          ? `The last ${data.events.length} of ${data.total} events`
          : `${data.total} ${data.total === 1 ? "event" : "events"}`}
        , kept until {new Date(data.keptUntil).toLocaleDateString()}.
      </Said>
      <ol className="m-0 flex max-h-90 list-none flex-col gap-1 overflow-y-auto p-0 text-sm">
        {data.events.map((entry, index) => (
          <RunEventLine key={index} entry={entry} rounds={rounds} />
        ))}
      </ol>
    </>
  );
}

/** A line the panel says about itself, as opposed to the events it lists. */
function Said({ children }: { children: ReactNode }) {
  return <p className="m-0 text-sm text-muted-foreground">{children}</p>;
}

function RunEventLine({
  entry,
  rounds,
}: {
  entry: AdminRunEvent;
  rounds: boolean;
}) {
  const { type, ...rest } = entry.event;
  const detail = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-muted-foreground tabular-nums">
        +{entry.ms} ms{rounds ? ` · round ${entry.round + 1}` : ""}
      </span>
      <span className="font-semibold">{type ?? "(no type)"}</span>
      {detail && (
        <code className="basis-full font-mono text-xs wrap-anywhere whitespace-pre-wrap">
          {detail}
        </code>
      )}
    </li>
  );
}
