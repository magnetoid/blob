/** Putting Markdown markers around a selection, and taking them off again.
 *
 * Pure string arithmetic, kept out of the composer so the rule can be read on its own:
 * a marker already present is removed whether it sits *inside* the selection
 * (`**bold**` selected) or just *around* it (`bold` selected inside `**bold**`).
 */

export interface Wrapped {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function wrapSelection(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string = before,
): Wrapped {
  const selected = text.slice(start, end);

  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  if (
    start >= before.length &&
    text.slice(start - before.length, start) === before &&
    text.slice(end, end + after.length) === after
  ) {
    const selectionStart = start - before.length;
    return {
      text:
        text.slice(0, selectionStart) +
        selected +
        text.slice(end + after.length),
      selectionStart,
      selectionEnd: selectionStart + selected.length,
    };
  }

  return {
    text: text.slice(0, start) + before + selected + after + text.slice(end),
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

/**
 * Inline code cannot hold a newline — the renderer's rule is `` [^`\n]+ `` — so a
 * selection spanning lines becomes a fenced block instead.
 */
export function codeMarkers(selected: string): [string, string] {
  return selected.includes("\n") ? ["```\n", "\n```"] : ["`", "`"];
}
