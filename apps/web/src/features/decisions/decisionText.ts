/** The decision log's limits, as the server keeps them (`services/decision_log.py`). */
export const TITLE_MAX = 200;
export const RATIONALE_MAX = 2000;

/** A message's words as a decision's first draft: one line, at most the log's limit. */
export function firstDraft(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1)}…`;
}
