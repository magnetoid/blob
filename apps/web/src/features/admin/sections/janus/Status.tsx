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
    <div className="janus-part">
      <h3 className="section-label">Janus itself</h3>

      {restart.restarting && (
        <div className="janus-banner" role="status">
          Janus is restarting. It finishes the turns it is already running before it goes,
          so this can take a few minutes; the page picks it up again the moment it answers.
        </div>
      )}

      {restart.lost && (
        <div className="janus-banner" data-bad="true" role="status">
          Janus has not come back yet. It may still be draining a long turn; if it does not
          return, the container's logs are where the reason is. Retry below asks it again,
          and is the way back: until it answers, nothing here can be changed or restarted.
        </div>
      )}

      <div className="health-grid">
        <div className="stat">
          <div className="stat-label">Gateway</div>
          <div className="stat-value" data-bad={down}>
            {down ? "Not answering" : "Answering"}
          </div>
          {down && reason && <div className="stat-hint">{reason}</div>}
          {!down && config.restart_pending && (
            <div className="stat-hint">A restart is pending.</div>
          )}
        </div>
        <div className="stat">
          <div className="stat-label">Version</div>
          <div className="stat-value">{config.version || "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Answers as</div>
          <div className="stat-value">{config.model.default || "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Through</div>
          <div className="stat-value">{config.model.provider || "—"}</div>
        </div>
      </div>

      {/* Two ways to reach one row, and they are different facts. The second is the one
          that used to draw a page of dead controls with nothing saying why: the five
          routes are fetched independently, so `/v1/config` can fail on its own. A restart
          that never came back arrives here as `down`, which its caller decides — the
          readings above are from before it, and asking again is the only useful move. */}
      {(down || unreadable) && (
        <div className="admin-row janus-retry">
          <span className="pref-hint grow">
            {down
              ? "What Janus runs on cannot be read while it is not answering, so nothing below can be changed."
              : "Janus is answering but did not say what it runs on, so nothing below can be changed."}
            {/* Under "Not answering" the reason is already in the tile; here there is no
                tile it belongs to, because the gateway itself is fine. */}
            {!down && reason && <span className="block">{reason}</span>}
          </span>
          <button type="button" className="btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
