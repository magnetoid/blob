/** Janus itself: what the machine's admin configures, through Janus's own API.
 *
 * The other half of this page is the workspace's `plugins` row. This half is not Blob's
 * data at all — it is `config.yaml` and a `.env` on Janus's volume, read and written over
 * `GET`/`PUT /v1/config`, and every value on the screen came from Janus a moment ago.
 * That is what makes the three states below different from an ordinary section's:
 *
 * * **Not this admin's** — `/api/admin/janus` answers 403 to a workspace admin who does
 *   not administer this machine, and `JanusSection` skips the request entirely for one it
 *   can already tell is not the server's admin. Both reach the same line naming who can,
 *   rather than silence: the row in the nav is not `ownerOnly`, so somebody who arrives
 *   here and finds half a page needs to be told it is a permission and not a bug.
 * * **Not configured** — `Setup` already owns that screen, and it is the whole page.
 * * **Not answering** — Janus is down or restarting. The controls stay on the screen and
 *   go dead, with the reason above them, for the same reason the workspace half draws its
 *   inert controls rather than hiding them: a control that has quietly gone missing reads
 *   as a thing Blob cannot do.
 *
 * Each form is keyed on the values it was seeded with. A save reloads the overview, and
 * the key is what makes the reloaded values reach the boxes instead of losing to state
 * that was seeded once — the same trick `BudgetRow` and `Instructions` use next door.
 */

import { useCallback } from "react";
import type { JanusOverview } from "../../../../lib/api.ts";
import { Card, CardNotice } from "../../../console/Card.tsx";
import { useJanusSave, useRestartWatch } from "./apply.ts";
import { BehaviourForm } from "./BehaviourForm.tsx";
import { ModelForm } from "./ModelForm.tsx";
import { RawConfig } from "./RawConfig.tsx";
import { Restart } from "./Restart.tsx";
import { Skills } from "./Skills.tsx";
import { Status } from "./Status.tsx";
import { Toolsets } from "./Toolsets.tsx";
import { readConfig, readSkills, UNKNOWN } from "./config.ts";

export function ThisServer({
  overview,
  code,
  isOwner,
  onError,
  onApplied,
}: {
  overview: JanusOverview | null;
  /** Why the overview is missing, when it is. */
  code: string | null;
  isOwner: boolean;
  onError: (message: string | null) => void;
  /** Janus took a change and is running on it: re-read the whole overview. */
  onApplied: () => void;
}) {
  const restart = useRestartWatch(onApplied);

  // One per form, so a refusal shows under the form that caused it and nowhere else.
  const model = useJanusSave({ onError, onApplied, restart });
  const behaviour = useJanusSave({ onError, onApplied, restart });
  const toolsets = useJanusSave({ onError, onApplied, restart });
  const raw = useJanusSave({ onError, onApplied, restart });

  // `restart.clear`, not `restart`: the watch is a fresh object every render.
  const clearRestart = restart.clear;
  const retry = useCallback(() => {
    onError(null);
    clearRestart();
    onApplied();
  }, [onError, onApplied, clearRestart]);

  // A permission, and there is nothing to retry: the page says who can and stops. Two
  // ways in and one sentence, because it is one fact. `forbidden` is the route's answer;
  // `!isOwner` is the same answer arrived at without asking, which is why `JanusSection`
  // may skip the request — an optimisation that changed what the page said would not be
  // one. The silence this replaced was the state a plain workspace admin actually got.
  if (!isOwner || code === "forbidden") {
    return (
      <Card>
        <CardNotice>Only the server's admin can change what Janus runs on.</CardNotice>
      </Card>
    );
  }
  // `Setup` is the whole page in that state, and says more than this half could.
  if (code === "janus_not_configured") return null;
  // The route itself did not answer — Blob's, not Janus's, since a Janus that is down
  // still comes back as a 200 with the reason in each part. Worth a button.
  if (!overview) {
    return (
      <Card>
        <div className="admin-row janus-retry">
          <span className="pref-hint grow">What Janus runs on could not be read just now.</span>
          <button type="button" className="btn" onClick={retry}>
            Retry
          </button>
        </div>
      </Card>
    );
  }

  const config = readConfig(overview.config.data);
  // `lost` counts as down, and is the only part of this that is not a fresh reading: a
  // restart that never came back leaves the overview on the screen the *healthy* one from
  // before it, so without this the tile read "Answering" above "Janus has not come back
  // yet" and every form was editable against values Janus may no longer hold. The last
  // thing actually observed was three minutes of `/health` not answering.
  const down = !overview.health.data || restart.lost;
  // Dead when Janus is not answering, while it is going down and back up, and when it
  // answered `/health` but not `/v1/config` — a form filled from nothing must not save.
  const dead = down || restart.restarting || config === null;

  return (
    <>
      <Status
        config={config ?? UNKNOWN}
        down={down}
        unreadable={config === null}
        reason={down ? overview.health.error : overview.config.error}
        restart={restart}
        onRetry={retry}
      />

      <ModelForm
        key={`model:${keyOf(config?.model)}`}
        config={config ?? UNKNOWN}
        disabled={dead}
        save={model}
      />

      <BehaviourForm
        key={`agent:${keyOf(config?.agent)}`}
        config={config ?? UNKNOWN}
        disabled={dead}
        save={behaviour}
      />

      <Toolsets
        key={`toolsets:${keyOf(config?.toolsets.enabled)}`}
        config={config ?? UNKNOWN}
        disabled={dead}
        save={toolsets}
      />

      <Skills skills={readSkills(overview.skills.data)} error={overview.skills.error} />

      <RawConfig
        key={`raw:${config?.raw ?? ""}`}
        config={config ?? UNKNOWN}
        disabled={dead}
        save={raw}
      />

      <Restart disabled={down || restart.restarting} restart={restart} onError={onError} />
    </>
  );
}

/**
 * A remount key for one form's saved values.
 *
 * `JSON.stringify` rather than a hand-written template because these are Janus's fields
 * and the page must not have a second list of them to keep in step — a field added to
 * `agent` should re-seed the box that shows it without anybody remembering to add it here.
 */
function keyOf(value: unknown): string {
  return JSON.stringify(value ?? null);
}
