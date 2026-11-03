/** Is Janus up, what is it, and what is it answering as.
 *
 * Four readings, two banners and a Retry. The readings are deliberately the four an
 * operator checks before touching anything below, and the row under them is the reason
 * this part exists at all: a form filled from a config that was never read is the one
 * screen this page must not present without a word.
 *
 * The banners are drawn here and *owned* in `apply.ts`. Any of the four forms can start a
 * restart, and so can the Restart button, so the watch cannot live in the part that draws
 * it.
 */

import type { ReactNode } from "react";
import { cn } from "cn";
import { Alert, AlertDescription } from "../../../../components/ui/alert.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import { Card } from "../../../console/Card.tsx";
import type { JanusConfig } from "./config.ts";
import type { RestartWatch } from "./apply.ts";

export function Status({
  config,
  down,
  unreadable,
  reason,
  restart,
  onRetry,
}: {
  config: JanusConfig;
  /** Janus did not answer `/health` — or a restart never brought it back, which its
   *  caller folds in here, because the last thing observed was the same silence. */
  down: boolean;
  /** Janus did not say what it runs on — which can happen while `/health` is fine. */
  unreadable: boolean;
  /** Why, in whatever words the failure arrived with. */
  reason: string | null;
  restart: RestartWatch;
  onRetry: () => void;
}) {
  return (
    <Card title="Janus itself">
      {/* Both said politely: a restart is progress, and one that did not come back is the
          state the page is in, not a thing that has just happened. */}
      {restart.restarting && (
        <Alert role="status">
          <AlertDescription>
            Janus is restarting. It finishes the turns it is already running before it goes,
            so this can take a few minutes; the page picks it up again the moment it answers.
          </AlertDescription>
        </Alert>
      )}

      {restart.lost && (
        <Alert variant="destructive" role="status">
          <AlertDescription>
            Janus has not come back yet. It may still be draining a long turn; if it does not
            return, the container's logs are where the reason is. Retry below asks it again,
            and is the way back: until it answers, nothing here can be changed or restarted.
          </AlertDescription>
        </Alert>
      )}

      {/* The four an operator checks before touching anything, each a term and its reading.
          A model id is one long token in a tile that is 170px wide on a phone, so it wraps. */}
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        <Reading label="Gateway" bad={down}>
          {down ? "Not answering" : "Answering"}
          {down && reason && <Hint>{reason}</Hint>}
          {!down && config.restart_pending && <Hint>A restart is pending.</Hint>}
        </Reading>
        <Reading label="Version">{config.version || "—"}</Reading>
        <Reading label="Answers as">{config.model.default || "—"}</Reading>
        <Reading label="Through">{config.model.provider || "—"}</Reading>
      </dl>

      {/* Two ways to reach one row, and they are different facts. The second is the one
          that used to draw a page of dead controls with nothing saying why: the five
          routes are fetched independently, so `/v1/config` can fail on its own. A restart
          that never came back arrives here as `down`, which its caller decides — the
          readings above are from before it, and asking again is the only useful move. */}
      {(down || unreadable) && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
            {down
              ? "What Janus runs on cannot be read while it is not answering, so nothing below can be changed."
              : "Janus is answering but did not say what it runs on, so nothing below can be changed."}
            {/* Under "Not answering" the reason is already in the tile; here there is no
                tile it belongs to, because the gateway itself is fine. */}
            {!down && reason && <span className="block">{reason}</span>}
          </p>
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </Card>
  );
}

/** One reading: what it is, and what it says. The value is what a screen reader hears
 * after the term, so the hint beneath it is part of it and is not a term of its own. */
function Reading({
  label,
  bad,
  children,
}: {
  label: string;
  /** Said in the danger colour, as well as in words. */
  bad?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border px-3.5 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "m-0 mt-1.5 text-base font-semibold tabular-nums wrap-anywhere",
          bad && "text-destructive",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** Only drawn when something is wrong, so it says what to do rather than what is. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 block text-xs leading-snug font-normal text-muted-foreground">
      {children}
    </span>
  );
}
