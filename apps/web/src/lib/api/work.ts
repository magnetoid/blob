/** `api.work` — see `lib/api.ts` for the assembled client. */

import type {
  ChannelWithState,
  Work,
  WorkArtifact,
} from "@blob/shared";
import { get, post } from "./client.ts";

/** Work channels: a conversation that became a place to build something. */
export const work = {
  start: (input: { rootMessageId: string; title: string; agentPluginIds: string[] }) =>
    post<{ work: Work; channel: ChannelWithState | null }>("/api/work", input),
  byChannel: (channelId: string) =>
    get<{ work: Work; artifacts: WorkArtifact[] }>(`/api/channels/${channelId}/work`),
  done: (workId: string) => post<{ work: Work }>(`/api/work/${workId}/done`),
  /** Put something into the work by hand. The same title and kind again is its next
   * version (M2 · A10). */
  publish: (
    workId: string,
    input: { kind: WorkArtifact["kind"]; title: string; body: string },
  ) => post<{ artifact: WorkArtifact }>(`/api/work/${workId}/artifacts`, input),
  /** The thread an artifact is discussed in, started now if nobody has yet. */
  discuss: (workId: string, artifactId: string) =>
    post<{ threadRootId: string }>(
      `/api/work/${workId}/artifacts/${artifactId}/discussion`,
    ),
  /** Approve one version, or send it back saying what should change. */
  review: (
    workId: string,
    artifactId: string,
    verdict: "approved" | "changes",
    note?: string,
  ) =>
    post<{ artifact: WorkArtifact }>(
      `/api/work/${workId}/artifacts/${artifactId}/review`,
      { verdict, note: note ?? null },
    ),
};
