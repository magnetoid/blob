/** An artifact and its versions, as the work tabs show them (M2 · A10). */

import type { WorkArtifact } from "@blob/shared";

export interface ArtifactGroup {
  /** Kind and title, as the server matches them: a title differing only in case or
   * spacing is the same artifact. */
  key: string;
  latest: WorkArtifact;
  /** Newest first. */
  versions: WorkArtifact[];
}

export function artifactKey(artifact: Pick<WorkArtifact, "kind" | "title">): string {
  return `${artifact.kind}:${artifact.title.trim().toLowerCase()}`;
}

/** Every artifact once, newest version first in each, the most recently changed on top. */
export function groupArtifacts(artifacts: WorkArtifact[]): ArtifactGroup[] {
  const groups = new Map<string, WorkArtifact[]>();
  for (const artifact of artifacts) {
    const key = artifactKey(artifact);
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
  }
  return [...groups.entries()]
    .map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { key, latest: sorted[0]!, versions: sorted };
    })
    .sort((a, b) => (a.latest.createdAt < b.latest.createdAt ? 1 : -1));
}
