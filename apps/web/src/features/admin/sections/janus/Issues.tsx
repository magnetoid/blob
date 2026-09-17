/** What Janus said about the last save, under the form that said it.
 *
 * Its own file rather than a corner of `apply.ts`, because a module exporting both a
 * component and a hook is a module fast refresh reloads whole.
 *
 * A live region, and named by the `id` its Save button points at with
 * `aria-describedby`. Both matter for the same reason: this text appears *after* a click,
 * beneath a button that still has focus, and the person who pressed it may not be looking
 * at the screen. Announced and attributed, or a refusal is silent.
 *
 * Mounted only when there is something to say, and each Save drops its `aria-describedby`
 * when there is not — a description pointing at an element that has left the document is
 * a dangling reference. The other way round is what `Toasts.tsx` records ("otherwise the
 * next failure recreates it and is silent again"), and it applies to a region that is
 * *fixed* on the screen; one sitting in a flex column would hold a gap open between every
 * form and its button for the announcement it is not making.
 */

import type { JanusIssue } from "./config.ts";

export function Issues({ id, issues }: { id: string; issues: JanusIssue[] }) {
  if (issues.length === 0) return null;
  return (
    // The region wraps the list rather than being it: `role="status"` on the `<ul>` would
    // take the list semantics with it, and a screen reader would lose "3 items".
    <div id={id} role="status" aria-live="polite">
      <ul className="janus-issues">
        {issues.map((issue, index) => (
          // Janus can answer with two issues carrying the same words and different hints,
          // so the index is the only honest identity here. The list is replaced whole on
          // every save, never reordered, which is what makes that safe.
          <li key={index} data-severity={issue.severity}>
            <span className={issue.severity === "error" ? "error-text" : "muted"}>
              {issue.message}
            </span>
            {issue.hint && <code className="janus-issue-hint">{issue.hint}</code>}
          </li>
        ))}
      </ul>
    </div>
  );
}
