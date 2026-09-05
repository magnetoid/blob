/** The work behind a channel, kept fresh as `work.updated` frames arrive. */

import { useEffect, useState } from "react";
import type { Work, WorkArtifact } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";

/** Loads the work behind a channel and keeps it fresh as `work.updated` frames arrive. */
export function useWork(channelId: string, workId: string | null) {
  const [work, setWork] = useState<Work | null>(null);
  const [artifacts, setArtifacts] = useState<WorkArtifact[]>([]);
  const version = useStore((s) => s.workVersions[channelId] ?? 0);

  useEffect(() => {
    if (!workId) return;
    let cancelled = false;
    void api.work
      .byChannel(channelId)
      .then((detail) => {
        if (cancelled) return;
        setWork(detail.work);
        setArtifacts(detail.artifacts);
      })
      .catch(showError);
    return () => {
      cancelled = true;
    };
  }, [channelId, workId, version]);

  // A channel with no work shows none, whatever the last work channel left behind —
  // derived here rather than reset in the effect, so no render is spent on clearing.
  if (!workId || work?.channelId !== channelId)
    return { work: null, artifacts: [] };
  return { work, artifacts };
}
