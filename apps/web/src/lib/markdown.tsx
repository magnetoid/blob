/**
 * Message rendering.
 *
 * A deliberately small Markdown subset rendered straight to React elements. Nothing
 * ever becomes raw HTML — there is no dangerouslySetInnerHTML anywhere in this file —
 * so a message body cannot inject markup no matter what it contains.
 *
 * Three dialects of it, by who wrote the text:
 *
 * - **A person's message**: fenced code, `> ` quotes, `-`/`*`/`+` and `1.` lists, and
 *   paragraphs. Lists keep their numbers across blank lines and nest under an indented
 *   item, because that is how anybody writes a list, not only a model.
 * - **An agent's reply** (`agent`): all of that, and the rest of what a language model
 *   writes — `#` lines as section labels, pipe tables, `---` dividers — which used to
 *   arrive as raw hashes and pipes.
 * - **A document** (`headings`): a shared `.md`, a work channel's write-up, with real
 *   `<h1>`–`<h6>`.
 */

import { Fragment, type ReactNode } from "react";
import type { CustomEmoji } from "@blob/shared";
import { resolveName } from "./emoji.ts";
import type { MentionTarget } from "../features/messages/mentionIndex.ts";
import { CodeBlock } from "../components/CodeBlock.tsx";

export interface RenderOptions {
  /**
   * Lowercased handle → what it names, for highlighting mentions.
   *
   * People and groups in one map, mirroring the server's `workspace_handles`. Built by
   * `features/messages/mentionIndex`, which is also where "is this about me" is decided
   * — a group mention is about you when you are in the group.
   */
  knownNames: Map<string, MentionTarget>;
  currentUserId: string | null;
  /** The workspace's own emoji, for resolving `:name:`. */
  customEmoji: readonly CustomEmoji[];
  /** Leftover search words to wrap in <mark>. Omit when not in a search result. */
  highlight?: string;
  /**
   * `#` to `######` headings. Documents only — a shared `.md`, a work channel's write-up.
   * A message has none, as Slack's do not: a `#` at the start of a chat line is a channel
   * or a number far more often than a title, and a message that grew an `<h1>` would
   * shout over every row around it.
   */
  headings?: boolean;
  /**
   * An agent wrote this — a bot's message (ADR 0005), Janus's answer the usual one.
   *
   * A model writes Markdown whether or not anybody asked it to, so its reply gets the
   * parts a person's chat line does not: a `#` line becomes a section label, a pipe table
   * a table, a `---` line a divider. The label is a bold `<p>` at body size and never an
   * `<h1>`–`<h6>`: a real heading inside a chat row would put every answer in the channel
   * into a screen reader's list of headings, beside the page's own. With `headings` as
   * well, a document's real headings win.
   */
  agent?: boolean;
  /**
   * Whether a code block offers its Copy button. Off where the whole rendering sits
   * inside a button — a search hit, a pinned row — because a button cannot hold another
   * one: the inner control vanishes from the accessibility tree. There the row opens the
   * message, and the copy is on the message.
   */
  copyableCode?: boolean;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
/** A list item, once its indentation is off: `- `, `* `, `+ `, or a number and a dot —
 *  nine digits at most, as CommonMark has it, so `start` stays a number a browser counts. */
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^(\d{1,9})\.\s+(.*)$/;
/** CommonMark's thematic break: three or more of one of `-`, `*` or `_`, spaces allowed. */
const DIVIDER = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A table's second row: a run of dashes per column, a `:` at either end for alignment. */
const DELIMITER_ROW = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

/** Block-level parse: fenced code, quotes, lists, paragraphs — and the headings, tables
 *  and dividers of a document or an agent's reply. */
export function renderMarkdown(
  source: string,
  options: RenderOptions,
): ReactNode {
  const blocks: ReactNode[] = [];
  // A CRLF body must not leave a `\r` at the end of every line for the patterns below to
  // trip on: `$` does not match before one, and every list would quietly stop being one.
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !(lines[index] as string).startsWith("```")
      ) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push(
        <CodeBlock
          key={key++}
          code={body.join("\n")}
          language={language || undefined}
          copyable={options.copyableCode !== false}
        />,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (
        index < lines.length &&
        (lines[index] as string).startsWith("> ")
      ) {
        body.push((lines[index] as string).slice(2));
        index += 1;
      }
      blocks.push(
        <blockquote key={key++}>
          {renderInline(body.join("\n"), options)}
        </blockquote>,
      );
      continue;
    }

    const headingMatch =
      options.headings || options.agent ? line.match(HEADING) : null;
    if (headingMatch) {
      const text = renderInline(headingMatch[2] as string, options);
      if (options.headings) {
        const Tag = `h${(headingMatch[1] as string).length}` as
          | "h1"
          | "h2"
          | "h3"
          | "h4"
          | "h5"
          | "h6";
        blocks.push(<Tag key={key++}>{text}</Tag>);
      } else {
        // Every level alike: a reply is read top to bottom, not navigated by its outline,
        // and six sizes of bold in one chat row would be an outline nobody asked for.
        blocks.push(
          <p key={key++} className="md-section">
            <strong>{text}</strong>
          </p>,
        );
      }
      index += 1;
      continue;
    }

    if (options.agent && DIVIDER.test(line)) {
      blocks.push(<hr key={key++} className="md-divider" />);
      index += 1;
      continue;
    }

    const table = options.agent ? tableAt(lines, index) : null;
    if (table) {
      blocks.push(renderTable(table, options, key++));
      index = table.next;
      continue;
    }

    if (itemAt(line, options)?.indent === 0) {
      const { list, next } = parseList(lines, index, options);
      blocks.push(renderList(list, options, key++));
      index = next;
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (current.trim() === "" || opensBlock(lines, index, options)) break;
      paragraph.push(current);
      index += 1;
    }
    blocks.push(
      <p key={key++}>{renderInline(paragraph.join("\n"), options)}</p>,
    );
  }

  return <>{blocks}</>;
}

/** Whether the line at `index` starts something other than a paragraph — which is where
 *  a paragraph running into it ends. */
function opensBlock(
  lines: string[],
  index: number,
  options: RenderOptions,
): boolean {
  const line = lines[index] as string;
  if (line.startsWith("```") || line.startsWith("> ")) return true;
  if (itemAt(line, options)?.indent === 0) return true;
  if ((options.headings || options.agent) && HEADING.test(line)) return true;
  return Boolean(
    options.agent && (DIVIDER.test(line) || tableAt(lines, index) !== null),
  );
}

// ─── lists ──────────────────────────────────────────────────────────────────

interface ItemLine {
  /** Columns of whitespace before the marker, a tab reaching the next multiple of four. */
  indent: number;
  ordered: boolean;
  /** An ordered item's own number: what its list counts from, when it comes first. */
  number: number;
  text: string;
}

/** What one item holds, in order: its text, a list under it, a fenced block or — in an
 *  agent's reply — a table in it. */
type ItemPart =
  | { kind: "text"; lines: string[] }
  | { kind: "list"; list: ListNode }
  | { kind: "code"; code: string; language: string }
  | { kind: "table"; table: TableNode };

interface ListNode {
  ordered: boolean;
  start: number;
  /** Its items were written a blank line apart, so they are drawn apart. */
  loose: boolean;
  items: ItemPart[][];
}

/** The list item on this line, at whatever indentation, or null. */
function itemAt(line: string, options: RenderOptions): ItemLine | null {
  const text = line.trimStart();
  // `* * *` and `- - -` are dividers in an agent's reply, which is the order CommonMark
  // tries them in too — anywhere else they are bullets with stars in them.
  if (options.agent && DIVIDER.test(text)) return null;
  const indent = indentOf(line);
  const bullet = BULLET.exec(text);
  if (bullet) {
    return { indent, ordered: false, number: 1, text: bullet[1] as string };
  }
  const ordered = ORDERED.exec(text);
  if (ordered) {
    return {
      indent,
      ordered: true,
      number: Number(ordered[1]),
      text: ordered[2] as string,
    };
  }
  return null;
}

function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/** `line` without its first `columns` columns of indentation. */
function dedent(line: string, columns: number): string {
  let width = 0;
  let index = 0;
  while (index < line.length && width < columns) {
    const char = line[index];
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
    index += 1;
  }
  return line.slice(index);
}

/**
 * The list starting at `from`, and everything indented under its items.
 *
 * Indentation decides what belongs where, and generously, because models and people
 * indent by two, three, four or a tab: a line two or more columns in from an item's
 * marker is that item's — a list under it, a fenced block or (an agent's) table in it, or
 * more of its text. An item of the same kind at the marker's own indentation is the next
 * item, even after a blank line. That used to end the list, so `1. … 2. …` written with a
 * gap between them drew two lists that both said "1.".
 */
function parseList(
  lines: string[],
  from: number,
  options: RenderOptions,
): { list: ListNode; next: number } {
  const first = itemAt(lines[from] as string, options) as ItemLine;
  const indent = first.indent;
  const list: ListNode = {
    ordered: first.ordered,
    start: first.number,
    loose: false,
    items: [],
  };
  let item: ItemPart[] | null = null;
  // A blank line went by inside the item: what follows is a paragraph of its own.
  let gap = false;
  let index = from;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.trim() === "") {
      let ahead = index + 1;
      while (ahead < lines.length && (lines[ahead] as string).trim() === "") {
        ahead += 1;
      }
      const next = lines[ahead];
      if (next === undefined) break;
      const nextIndent = indentOf(next);
      const nextItem = itemAt(next, options);
      if (
        nextItem &&
        nextItem.ordered === list.ordered &&
        nextIndent >= indent &&
        nextIndent < indent + 2
      ) {
        list.loose = true;
        index = ahead;
        continue;
      }
      if (item && nextIndent >= indent + 2) {
        gap = true;
        index = ahead;
        continue;
      }
      break;
    }

    const lineIndent = indentOf(line);
    const lineItem = itemAt(line, options);

    if (lineItem) {
      if (lineIndent < indent) break; // an outer list's next item
      if (item && lineIndent >= indent + 2) {
        const nested = parseList(lines, index, options);
        item.push({ kind: "list", list: nested.list });
        index = nested.next;
        gap = false;
        continue;
      }
      if (lineItem.ordered !== list.ordered) break; // a list of the other kind begins
      item = [{ kind: "text", lines: [lineItem.text] }];
      list.items.push(item);
      gap = false;
      index += 1;
      continue;
    }

    // Not indented under the item: the list is over, and the line is the next block's.
    if (!item || lineIndent < indent + 2) break;

    // "2. Compare the options:" and a table under it — the table is the step's.
    const table = options.agent ? tableAt(lines, index) : null;
    if (table) {
      item.push({ kind: "table", table });
      index = table.next;
      gap = false;
      continue;
    }

    const text = line.trimStart();
    if (text.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !(lines[index] as string).trimStart().startsWith("```")
      ) {
        body.push(dedent(lines[index] as string, lineIndent));
        index += 1;
      }
      index += 1; // closing fence
      item.push({
        kind: "code",
        code: body.join("\n"),
        language: text.slice(3).trim(),
      });
      gap = false;
      continue;
    }

    const last = item[item.length - 1];
    if (!gap && last?.kind === "text") last.lines.push(text);
    else item.push({ kind: "text", lines: [text] });
    gap = false;
    index += 1;
  }

  return { list, next: index };
}

function renderList(
  list: ListNode,
  options: RenderOptions,
  key: number,
): ReactNode {
  const items = list.items.map((item, index) => (
    <li key={index}>{renderItem(item, options)}</li>
  ));
  const loose = list.loose ? "true" : undefined;
  return list.ordered ? (
    // `start` only when it is not 1, so an ordinary list is the markup it always was —
    // and a list resumed after a paragraph between its items keeps counting.
    <ol
      key={key}
      start={list.start === 1 ? undefined : list.start}
      data-loose={loose}
    >
      {items}
    </ol>
  ) : (
    <ul key={key} data-loose={loose}>
      {items}
    </ul>
  );
}

function renderItem(item: ItemPart[], options: RenderOptions): ReactNode {
  // One run of text is the item itself, bare in the <li> as it always was; two or more
  // are paragraphs of it, and need telling apart.
  const paragraphs = item.filter((part) => part.kind === "text").length > 1;
  return item.map((part, index) => {
    switch (part.kind) {
      case "list":
        return renderList(part.list, options, index);
      case "code":
        return (
          <CodeBlock
            key={index}
            code={part.code}
            language={part.language || undefined}
            copyable={options.copyableCode !== false}
          />
        );
      case "table":
        return renderTable(part.table, options, index);
      case "text": {
        const text = renderInline(part.lines.join("\n"), options);
        return paragraphs ? (
          <p key={index}>{text}</p>
        ) : (
          <Fragment key={index}>{text}</Fragment>
        );
      }
    }
  });
}

// ─── tables ─────────────────────────────────────────────────────────────────

type Align = "left" | "center" | "right" | null;

interface TableNode {
  header: string[];
  align: Align[];
  rows: string[][];
  /** The line after the table. */
  next: number;
}

/**
 * A GitHub-style pipe table starting at `index`, or null.
 *
 * A header row, then a delimiter row with as many columns — GFM's rule, and what keeps a
 * line that merely has a pipe in it, above a line of dashes, from becoming a table — then
 * body rows until a blank line or a line with no pipe in it. GFM would make that last line
 * a one-cell row; in a chat it reads as the table swallowing the sentence after it.
 */
function tableAt(lines: string[], index: number): TableNode | null {
  const head = lines[index] as string;
  const rule = lines[index + 1];
  if (rule === undefined || !head.includes("|") || !rule.includes("|")) {
    return null;
  }
  if (!DELIMITER_ROW.test(rule.trim())) return null;
  const header = cellsOf(head);
  const align = cellsOf(rule).map(alignOf);
  if (header.length !== align.length) return null;

  const rows: string[][] = [];
  let next = index + 2;
  while (next < lines.length) {
    const line = lines[next] as string;
    if (line.trim() === "" || !line.includes("|")) break;
    const cells = cellsOf(line);
    // Ragged rows are evened out the way GFM does it: a short one gets empty cells, and
    // what a long one has past the header's columns is not drawn.
    rows.push(header.map((_, column) => cells[column] ?? ""));
    next += 1;
  }
  return { header, align, rows, next };
}

/** A row's cells: split on the pipes that are not escaped, the outer pair optional. */
function cellsOf(row: string): string[] {
  let text = row.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return left ? "left" : null;
}

/**
 * A cell this short — a figure and its unit, a date, a name — stays on one line.
 *
 * A table too wide for its box is laid out at its narrowest, every column squeezed to its
 * longest word, which put `2,400` and `ms` on two lines and broke `eu-west-1` at its
 * hyphen: a row stopped reading across. Held whole, the table scrolls a little sooner
 * instead. Anything longer is prose, and wraps.
 */
const SHORT_CELL = 24;

/** A real table — its rows and columns are a screen reader's to walk — in a box that
 *  scrolls sideways, so that a wide one never makes the conversation do it. */
function renderTable(
  table: TableNode,
  options: RenderOptions,
  key: number,
): ReactNode {
  const short = (cell: string) =>
    cell.length <= SHORT_CELL ? "true" : undefined;
  return (
    <div key={key} className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {table.header.map((cell, column) => (
              <th
                key={column}
                scope="col"
                data-align={table.align[column] ?? undefined}
                data-short={short(cell)}
              >
                {renderInline(cell, options)}
              </th>
            ))}
          </tr>
        </thead>
        {table.rows.length > 0 && (
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, column) => (
                  <td
                    key={column}
                    data-align={table.align[column] ?? undefined}
                    data-short={short(cell)}
                  >
                    {renderInline(cell, options)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

// ─── inline ─────────────────────────────────────────────────────────────────

/** Wrap leftover search words. Never parses HTML — only splits the author's text. */
function highlightText(text: string, needle: string | undefined): ReactNode {
  const raw = needle?.trim();
  if (!raw || !text) return text;
  const tokens = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (!tokens.length) return text;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  if (parts.length === 1) return text;
  const lower = new Set(tokens.map((token) => token.toLowerCase()));
  return parts.map((part, index) =>
    lower.has(part.toLowerCase()) ? (
      <mark key={index} className="search-hit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

type InlineRule = {
  pattern: RegExp;
  render: (
    match: RegExpExecArray,
    options: RenderOptions,
    key: number,
  ) => ReactNode;
};

const INLINE_RULES: InlineRule[] = [
  // Code first: its contents must not be parsed further.
  {
    pattern: /`([^`\n]+)`/,
    render: (m, _o, key) => <code key={key}>{m[1]}</code>,
  },
  {
    pattern: /\*\*([^*\n]+)\*\*/,
    render: (m, o, key) => (
      <strong key={key}>{renderInline(m[1] as string, o)}</strong>
    ),
  },
  {
    pattern: /\*([^*\n]+)\*/,
    render: (m, o, key) => <em key={key}>{renderInline(m[1] as string, o)}</em>,
  },
  {
    pattern: /_([^_\n]+)_/,
    render: (m, o, key) => <em key={key}>{renderInline(m[1] as string, o)}</em>,
  },
  {
    pattern: /~~([^~\n]+)~~/,
    render: (m, o, key) => (
      <del key={key}>{renderInline(m[1] as string, o)}</del>
    ),
  },
  {
    // The destination may contain balanced parentheses, which is CommonMark's rule and
    // also just how a lot of real links are shaped — every Wikipedia disambiguation, most
    // of MSDN. `[^\s)]+` stopped at the first `)`, so
    // `[x](https://en.wikipedia.org/wiki/Mercury_(planet))` linked to
    // `…/Mercury_(planet` and left a stray bracket in the text: a broken link that looks
    // like a link. One level of nesting is all a URL ever has.
    pattern: /\[([^\]\n]+)\]\((https?:\/\/(?:\([^\s<()]*\)|[^\s<()])+)\)/,
    render: (m, _o, key) => (
      <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  {
    // Same balanced-paren rule for a bare URL, and the same trailing-punctuation guard
    // as before: a link at the end of a sentence must not swallow the full stop, and one
    // inside `(see https://example.com)` must not swallow the closing bracket. So it ends
    // either on a balanced group — the Wikipedia case — or on a character that cannot be
    // punctuation.
    pattern:
      /(https?:\/\/(?:\([^\s<()]*\)|[^\s<()])*(?:\([^\s<()]*\)|[^\s<.,:;"'()\]]))/,
    render: (m, _o, key) => (
      <a key={key} href={m[1]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  {
    // Mentions: only render as a mention if the name is one we know.
    pattern:
      /@([\p{L}\p{N}][\p{L}\p{N}._'-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._'-]*)?)/u,
    render: (m, o, key) => {
      const raw = m[1] as string;
      const candidates = [raw, raw.split(/\s+/)[0] as string];
      for (const candidate of candidates) {
        const bare = candidate.replace(/[.,!?;:]+$/, "");
        const target = o.knownNames.get(bare.toLowerCase());
        if (target) {
          const rest = raw.slice(bare.length);
          return (
            <Fragment key={key}>
              <span
                className="mention"
                data-me={target.isMe}
                data-kind={target.kind}
              >
                @{bare}
              </span>
              {rest}
            </Fragment>
          );
        }
      }
      const token = raw.toLowerCase();
      if (token === "channel" || token === "here" || token === "everyone") {
        return (
          <span key={key} className="mention" data-me="true">
            @{raw}
          </span>
        );
      }
      return <Fragment key={key}>@{raw}</Fragment>;
    },
  },
  {
    // `:name:` — a workspace's own emoji, or one of the built-in shortcodes.
    //
    // The src never comes from the message. The body supplies a *name*, which has to
    // match something the workspace uploaded before any URL is produced, so a body
    // cannot point an <img> anywhere of its own choosing. An unknown name renders as
    // the literal text the author typed, which is also what makes a deleted custom
    // emoji degrade to `:name:` rather than to a broken image.
    pattern: /:([a-z0-9_+-]+):/,
    render: (m, o, key) => {
      const resolved = resolveName(m[1] as string, o.customEmoji);
      if (!resolved) return <Fragment key={key}>{m[0]}</Fragment>;
      if (resolved.kind === "unicode")
        return <Fragment key={key}>{resolved.char}</Fragment>;
      return (
        <img
          key={key}
          className="custom-emoji"
          src={resolved.url}
          alt={`:${resolved.name}:`}
          title={`:${resolved.name}:`}
          loading="lazy"
        />
      );
    },
  },
];

/** Inline parse: finds the earliest match among all rules and recurses around it. */
export function renderInline(text: string, options: RenderOptions): ReactNode {
  let earliest: { rule: InlineRule; match: RegExpExecArray } | null = null;

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    if (!earliest || match.index < (earliest.match.index ?? 0)) {
      earliest = { rule, match };
    }
  }

  if (!earliest) return highlightText(text, options.highlight);

  const { rule, match } = earliest;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  return (
    <>
      {highlightText(before, options.highlight)}
      {rule.render(match, options, 0)}
      {renderInline(after, options)}
    </>
  );
}
