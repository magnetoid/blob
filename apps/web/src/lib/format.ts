/** The small formatters three places had each written for themselves. */

/** "900 KB", "1.2 MB", "3.0 GB" — the same reading everywhere a size is shown. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** For `.sort()`: people by the name they chose, in the reader's collation. */
export function byDisplayName<T extends { displayName: string }>(a: T, b: T): number {
  return a.displayName.localeCompare(b.displayName);
}
