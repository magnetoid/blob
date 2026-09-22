/** Restart the gateway, changing nothing it runs on.
 *
 * Every save above already restarts Janus into the change. This is for the other case: a
 * key that was put into the environment by hand, a file edited over `docker exec`, a
 * process that has wedged. It writes nothing, so there is nothing to confirm — the worst
 * it costs is the turns in flight, and those are drained rather than cut.
 */

import { useState } from "react";
import { api, ApiError } from "../../../../lib/api.ts";
import { Card } from "../../../console/Card.tsx";
import type { RestartWatch } from "./apply.ts";
import { issues as readIssues } from "./config.ts";

export function Restart({
  disabled,
  restart,
  onError,
}: {
  disabled: boolean;
  restart: RestartWatch;
  onError: (message: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);

  async function onClick() {
    onError(null);
    setAsking(true);
    try {
      const applied = await api.admin.restartJanus();
      // `restarting: false` is an honest answer, not a failure: a standalone API server
      // has no handle on a gateway to restart, and names the reason in its warnings. That
      // reason is carried through rather than pointed at — there is nowhere on this page
      // a restart's warnings would otherwise land.
      if (applied.restarting) {
        restart.begin(applied.drainTimeoutSeconds);
        return;
      }
      const why = readIssues(applied.warnings)[0]?.message;
      onError(
        why
          ? `Janus took the request and is not restarting: ${why}`
          : "Janus took the request and is not restarting.",
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setAsking(false);
    }
  }

  // A card whose one control is its header's: the title says what it does, and there is
  // nothing to fill in below it.
  return (
    <Card
      title="Restart Janus"
      description={
        <>
          Picks up a change made outside this page — a key put into the environment by
          hand, a file edited over <code>docker exec</code>. Running turns finish first,
          so it can take a few minutes, and nothing here is written or lost.
        </>
      }
      actions={
        <button
          type="button"
          className="btn"
          disabled={disabled || asking || restart.restarting}
          onClick={() => void onClick()}
        >
          Restart Janus
        </button>
      }
    />
  );
}
