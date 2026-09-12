/** The work behind a channel, kept fresh as `work.updated` frames arrive. */

import type { Work, WorkArtifact } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";
import { useFetch } from "../../lib/useFetch.ts";

/** Loads the work behind a channel and keeps it fresh as `work.updated` frames arrive. */
export function useWork(channelId: string, workId: string | null) {
  const version = useStore((s) => s.workVersions[channelId] ?? 0);
  const { data } = useFetch(
    (): Promise<{ work: Work; artifacts: WorkArtifact[] } | null> =>
      workId ? api.work.byChannel(channelId) : Promise.resolve(null),
    [channelId, workId, version],
    { onError: showError },
  );

  // A channel with no work shows none, whatever the last work channel left behind —
  // checked here rather than cleared anywhere, so no render is spent on clearing.
  if (!workId || !data || data.work.channelId !== channelId)
    return { work: null, artifacts: [] };
  return { work: data.work, artifacts: data.artifacts };
}
