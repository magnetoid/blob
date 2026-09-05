/** A first line of the message, as a title somebody can edit rather than type. */
export function suggestedTitle(body: string): string {
  const line =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith(">")) ?? "";
  const clean = line
    .replace(/^@\S+\s*/g, "")
    .replace(/[*_`~]/g, "")
    .trim();
  return (
    (clean.length > 80 ? `${clean.slice(0, 77).trimEnd()}…` : clean) ||
    "New work"
  );
}
