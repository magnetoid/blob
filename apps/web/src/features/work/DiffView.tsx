/** A unified diff, drawn — not executed, not parsed beyond its first character.
 *
 * Every line a diff can contain starts with something that says what it is: `+++`/`---`
 * name files, `@@` opens a hunk, `+` adds, `-` removes, a space is context, `\` is the
 * "no newline at end of file" note. That first character is the whole grammar this needs,
 * and it is why a diff viewer can be forty lines rather than a library: the text is user
 * content and stays text; colour is the only thing added.
 */

import { diffStats, parseDiff } from "./diff.ts";

export function DiffView({ body }: { body: string }) {
  const lines = parseDiff(body);
  const stats = diffStats(lines);
  return (
    <div className="diff-view">
      <div
        className="diff-stats"
        aria-label={`${stats.added} added, ${stats.removed} removed`}
      >
        <span className="diff-stat-add">+{stats.added}</span>
        <span className="diff-stat-del">−{stats.removed}</span>
      </div>
      <pre className="diff-body">
        {lines.map((line, index) => (
          <span key={index} className={`diff-line diff-${line.kind}`}>
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
