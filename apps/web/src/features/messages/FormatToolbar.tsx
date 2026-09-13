/** Bold, italic, code, strike, link, list — the marks the renderer understands. */

import { SHORTCUTS, describeKeys, isMac } from "../../lib/shortcuts.ts";

/**
 * A toolbar tooltip's chord, read from the same declarations `⌘/` renders — so the
 * toolbar cannot advertise a binding the keyboard layer doesn't have.
 */
function chordFor(id: string): string {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  return shortcut ? describeKeys(shortcut).join(isMac() ? "" : "+") : "";
}

function keepSelection(event: { preventDefault: () => void }) {
  // Only to keep the textarea's selection: without this the mousedown moves focus to
  // the button and the selection collapses before the action can read it. The action
  // itself is on click, so Enter and Space reach it too.
  event.preventDefault();
}

export function FormatToolbar({
  onWrap,
  onCode,
}: {
  onWrap: (before: string, after?: string) => void;
  onCode: () => void;
}) {
  const marks: Array<{
    label: string;
    title: string;
    action: () => void;
    glyph: React.ReactNode;
  }> = [
    {
      label: "Bold",
      title: `Bold (${chordFor("format-bold")})`,
      action: () => onWrap("**"),
      glyph: <strong>B</strong>,
    },
    // The renderer parses *x* and _x_ alike; `_` is what survives sitting directly
    // inside a ** wrap.
    {
      label: "Italic",
      title: `Italic (${chordFor("format-italic")})`,
      action: () => onWrap("_"),
      glyph: <em>I</em>,
    },
    {
      label: "Code",
      title: `Code (${chordFor("format-code")})`,
      action: onCode,
      glyph: <code>{"</>"}</code>,
    },
    {
      label: "Strikethrough",
      title: `Strikethrough (${chordFor("format-strike")})`,
      action: () => onWrap("~~"),
      glyph: <s>S</s>,
    },
    {
      label: "Link",
      title: "Link",
      action: () => onWrap("[", "](url)"),
      glyph: <span aria-hidden="true">🔗</span>,
    },
    {
      label: "List",
      title: "List",
      action: () => onWrap("- ", ""),
      glyph: <span aria-hidden="true">≡</span>,
    },
  ];
  return (
    <div className="composer-toolbar" role="toolbar" aria-label="Formatting">
      {marks.map((mark) => (
        <button
          key={mark.label}
          className="icon-btn"
          type="button"
          aria-label={mark.label}
          title={mark.title}
          onMouseDown={keepSelection}
          onClick={mark.action}
        >
          {mark.glyph}
        </button>
      ))}
    </div>
  );
}
