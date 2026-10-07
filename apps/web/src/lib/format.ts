/** The small formatters three places had each written for themselves. */

/** "900 KB", "1.2 MB", "3.0 GB" — the same reading everywhere a size is shown. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** For `.sort()`: people by the name they chose, in the reader's collation. */
/** A token count the way a person reads one: "380 tokens", "12.4k tokens", "1.3M tokens". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} token${tokens === 1 ? '' : 's'}`;
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k tokens`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

export function byDisplayName<T extends { displayName: string }>(a: T, b: T): number {
  return a.displayName.localeCompare(b.displayName);
}

/** When a connection ends, said the way a person plans by: a date, or that it has. */
export function formatEnds(expiresAt: string | null): string {
  if (!expiresAt) return 'never ends';
  const at = new Date(expiresAt);
  const date = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return at.getTime() <= Date.now() ? `ended ${date} — it no longer connects` : `ends ${date}`;
}
