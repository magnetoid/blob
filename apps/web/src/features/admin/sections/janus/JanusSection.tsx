/** Agents & apps → Janus: the one agent every workspace here has.
 *
 * Two halves on one page, because they are one question asked at two levels. **This
 * workspace** is any admin's: on or off, the channels, the budget, the instructions,
 * the run log, and a button that says hello. **This server** is the instance admin's:
 * what Janus itself runs on, read and written through Janus's own API.
 *
 * The split is load-bearing rather than cosmetic, and it is why the page makes **two**
 * requests rather than one. `/api/admin/janus` answers 403 to a workspace admin who does
 * not administer this machine, it can fail outright while Janus is down or restarting,
 * and answering it costs Janus five upstream calls — one of which asks its provider for a
 * model list. The plugin list is none of that: it is this workspace's own row, and it is
 * the whole workspace half. So they are fetched apart, reloaded apart — a budget edit
 * must not spend the overview's five calls, and a save on the server half must re-read
 * exactly what it changed — and the overview's failure is kept as a code rather than
 * raised, because nothing on the workspace half reads it.
 */

import { useCallback } from "react";
import { api, ApiError, type JanusOverview } from "../../../../lib/api.ts";
import { navigate } from "../../../../lib/router.ts";
import { useFetch } from "../../../../lib/useFetch.ts";
import type { ConsoleSectionProps } from "../../../console/ConsoleShell.tsx";
import { useAdminData } from "../../../console/hooks.ts";
import { Installs } from "./Installs.tsx";
import { Setup } from "./Setup.tsx";
import { ThisServer } from "./ThisServer.tsx";
import { ThisWorkspace } from "./ThisWorkspace.tsx";
import { janusRowOf } from "./seeded.ts";

interface OverviewState {
  /** Null when this admin may not read it, or when Janus itself could not be reached. */
  data: JanusOverview | null;
  /** The error code it failed with — `janus_not_configured` is a screen of its own. */
  code: string | null;
}

export function JanusSection({ onError, isOwner }: ConsoleSectionProps) {
  const listAgents = useCallback(() => api.admin.plugins(), []);
  const {
    data: listed,
    loading: listing,
    reload: reloadPlugins,
  } = useAdminData(listAgents, [], onError, "Could not load the agents installed here.");

  // `useFetch` rather than `useAdminData`, which exists to route a failure to the
  // console's error line: this loader has no failure to route. The 403 an ordinary admin
  // gets is not an error on a page that is theirs, and a Janus that is down is a state
  // the server half draws — so both are caught here and carried as a code.
  const readOverview = useCallback(async (): Promise<OverviewState> => {
    // Not asked for at all unless this could be the server's admin: to everybody else it
    // is a 403 in the network log, and `ThisServer` answers a code it never received with
    // the same line it answers the 403 with. Skipping the request saves the round trip
    // and changes nothing on the screen, which is the only thing that makes it safe.
    if (!isOwner) return { data: null, code: null };
    return api.admin.janus().then(
      (data) => ({ data, code: null }),
      (err: unknown) => ({
        data: null,
        code: err instanceof ApiError ? err.code : "unreachable",
      }),
    );
  }, [isOwner]);
  const {
    data: overview,
    loading: reading,
    reload: reloadOverview,
  } = useFetch(readOverview, [isOwner]);

  if (!listed) {
    return (
      <p className="pref-hint">
        {listing
          ? "Loading…"
          : "The agents installed here could not be read, so there is nothing on this page yet."}
      </p>
    );
  }

  const plugin = janusRowOf(listed.plugins);
  const notConfigured = overview?.code === "janus_not_configured";
  /**
   * The overview has not answered yet, and nothing below may guess what it will say.
   *
   * Both screens that read it are a statement about the server — "what Janus runs on
   * could not be read", "Janus is not running in this stack" — and the plugin list always
   * lands first, so a page that drew them from `overview === null` stated a failure it had
   * no evidence for, on every visit, for the whole life of the request. The Retry it
   * offered would have sent a second one.
   *
   * `loading` as well as the absence, and in that order: `useFetch` keeps `data` across a
   * reload, so this is only ever the first read — a save, or the restart watch finding
   * Janus back, never takes the forms off the screen. A loader that somehow settled
   * without data falls through to the states below rather than holding for ever.
   */
  const overviewPending = !overview && reading;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* The same way back an app's own page has. The row in the nav is one click away,
          but somebody who arrived here from the Apps list's Configure is in the middle of
          that list's job and should not have to find their way back to it. */}
      <div>
        <button className="btn btn-ghost" onClick={() => navigate("/admin/apps")}>
          ← All apps
        </button>
      </div>

      {/* Above the workspace half rather than instead of it: a row can outlive the
          settings that put it there, and an admin looking at an agent that has stopped
          answering needs both the row and the reason on one screen. */}
      {!overviewPending && (notConfigured || !plugin) && (
        <Setup overview={overview?.data ?? null} notConfigured={Boolean(notConfigured)} />
      )}

      {plugin && (
        <ThisWorkspace plugin={plugin} onError={onError} onChanged={reloadPlugins} />
      )}

      {/* Everything Janus itself runs on, for the server's admin alone. It draws nothing
          for anybody else, and nothing when there is no Janus to configure — `Setup`
          above is the whole page in that state. Every state it draws is a reading, so
          until the first one has arrived there is a line saying so and no more. */}
      {overviewPending ? (
        isOwner && <p className="pref-hint">Reading what Janus runs on…</p>
      ) : (
        <ThisServer
          overview={overview?.data ?? null}
          code={overview?.code ?? null}
          isOwner={isOwner}
          onError={onError}
          onApplied={reloadOverview}
        />
      )}

      <Installs installs={overview?.data?.installs ?? []} />
    </section>
  );
}
