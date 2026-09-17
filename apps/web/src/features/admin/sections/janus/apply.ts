/** Sending a change to Janus, and living with the answer.
 *
 * Four forms on this page write through one route, and every one of them has to do the
 * same four things with what comes back: raise the failure where the console shows
 * failures, render Janus's complaints beside the box that caused them, hand a restart to
 * the banner, and reload the page once the change is actually in effect. Written once
 * here because four copies would be four chances for one of them to forget the restart —
 * and a form that saves without starting the watch leaves the page showing the *old*
 * configuration with no indication that Janus is going down underneath it.
 *
 * The split is: `useRestartWatch` is the page's (there is one Janus and one banner), and
 * `useJanusSave` is each form's (issues belong under the form that caused them). The list
 * they produce is drawn by `Issues.tsx`, which is a separate file only because a module
 * that exports both hooks and a component gives up fast refresh for everything in it.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type JanusConfigChange } from "../../../../lib/api.ts";
import { issues as readIssues, type JanusIssue } from "./config.ts";

/** How often the page asks whether Janus is back. */
const POLL_MS = 3000;

/**
 * How long past the drain we keep asking.
 *
 * The drain is Janus's own deadline for finishing the turns it is running; the restart
 * itself, plus a container start and a first `/health`, is what this covers. Past it the
 * honest answer is "it has not come back", not an animation that spins for ever.
 */
const GRACE_MS = 30_000;

/** Janus's default, for a release whose answer carries no `drainTimeoutSeconds`. */
const DEFAULT_DRAIN_MS = 180_000;

export interface RestartWatch {
  /** True from the moment Janus says it is going until it answers `/health` again. */
  restarting: boolean;
  /** The drain ran out and Janus is still not answering. */
  lost: boolean;
  /** Janus is going down: start asking. Seconds, as `JanusApplied` reports them. */
  begin: (drainTimeoutSeconds: number) => void;
  /**
   * Stop saying it never came back.
   *
   * `lost` outlives the watch on purpose — it is the record of what happened, and the
   * page has no other way to know, since the overview it is holding is the one from
   * before the restart. So it is cleared by the person asking again, not by a timer.
   */
  clear: () => void;
}

/**
 * Wait for Janus to come back, then reload the page onto what it came back on.
 *
 * Polling rather than anything cleverer because a restart severs whatever Blob was
 * holding; there is nothing to keep open across it. It is cheap on both ends: Janus skips
 * the live provider `/models` call while a restart is pending, which is the one slow part
 * of `/v1/config`.
 */
export function useRestartWatch(onBack: () => void): RestartWatch {
  const [since, setSince] = useState<{ startedAt: number; capMs: number } | null>(null);
  const [lost, setLost] = useState(false);

  const begin = useCallback((drainTimeoutSeconds: number) => {
    const drain = drainTimeoutSeconds > 0 ? drainTimeoutSeconds * 1000 : DEFAULT_DRAIN_MS;
    setLost(false);
    setSince({ startedAt: Date.now(), capMs: drain + GRACE_MS });
  }, []);

  useEffect(() => {
    if (!since) return;
    let stopped = false;
    // One request at a time. A Janus that accepts the connection and then answers nothing
    // is the likeliest thing to be doing mid-restart, and without this every tick stacks
    // another `GET /api/admin/janus` on the ones already hanging — each of which fans out
    // to five requests at Janus's end, at the moment it has least to spare.
    let busy = false;

    const timer = setInterval(() => {
      // The cap first, and above the `busy` guard rather than after the request: a Janus
      // that accepts the connection and then answers nothing never settles, so a check
      // that ran only on the way back was a check that never ran. That left the page
      // `restarting` — every form dead, no banner and no Retry — until the browser's own
      // network timeout, which is minutes. The clock is the only thing that can end this.
      if (Date.now() - since.startedAt > since.capMs) {
        setSince(null);
        setLost(true);
        return;
      }
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const next = await api.admin.janus();
          if (stopped) return;
          if (next.health.data) {
            setSince(null);
            onBack();
          }
        } catch {
          // A refused request *is* the expected answer while a container is restarting.
          // Only the cap ends this, never one failure.
        } finally {
          busy = false;
        }
      })();
    }, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [since, onBack]);

  const clear = useCallback(() => setLost(false), []);

  return { restarting: since !== null, lost, begin, clear };
}

export interface JanusSave {
  /** Send it. Resolves when the answer has been dealt with, whatever the answer was. */
  run: (change: JanusConfigChange) => Promise<void>;
  /** What Janus said about the last attempt — its refusal's issues, or a save's warnings. */
  issues: JanusIssue[];
  /** A request is in flight: the form's controls are dead until it lands. */
  saving: boolean;
}

export function useJanusSave({
  onError,
  onApplied,
  restart,
}: {
  onError: (message: string | null) => void;
  /** The change landed and Janus is *not* restarting: re-read what it now runs on. */
  onApplied: () => void;
  restart: RestartWatch;
}): JanusSave {
  const [issues, setIssues] = useState<JanusIssue[]>([]);
  const [saving, setSaving] = useState(false);
  // The watch itself is a fresh object every render; its callbacks are not.
  const begin = restart.begin;

  const run = useCallback(
    async (change: JanusConfigChange) => {
      onError(null);
      setIssues([]);
      setSaving(true);
      try {
        const applied = await api.admin.updateJanus(change);
        // Warnings are things Janus did anyway — a toolset with no key, a value it had to
        // coerce. They belong beside the form for the same reason a refusal does.
        setIssues(readIssues(applied.warnings));
        if (applied.restarting) begin(applied.drainTimeoutSeconds);
        else onApplied();
      } catch (err) {
        if (!(err instanceof ApiError)) {
          onError("That did not work.");
          return;
        }
        onError(err.message);
        // Both places: the console's one error line is at the top of a page whose
        // Advanced box is long enough to have scrolled it away by the time Save is
        // clicked. A refusal with no list of its own still gets a row, because "the save
        // failed" has to be visible where the save happened.
        const listed = readIssues(err.detail?.issues);
        setIssues(listed.length > 0 ? listed : [{ severity: "error", message: err.message, hint: "" }]);
      } finally {
        setSaving(false);
      }
    },
    [onError, onApplied, begin],
  );

  return { run, issues, saving };
}
