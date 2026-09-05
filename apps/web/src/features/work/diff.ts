/** A unified diff, classified line by line. The first character is the whole grammar;
 * see DiffView.tsx for why a viewer can be this small. */

export type DiffLineKind = "file" | "hunk" | "add" | "del" | "ctx" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function classify(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (
    line.startsWith("\\") ||
    line.startsWith("diff ") ||
    line.startsWith("index ")
  )
    return "meta";
  return "ctx";
}

export function parseDiff(body: string): DiffLine[] {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text) => ({ kind: classify(text), text }));
}

export function diffStats(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added += 1;
    if (line.kind === "del") removed += 1;
  }
  return { added, removed };
}
