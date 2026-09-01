/**
 * Message rendering.
 *
 * A deliberately small Markdown subset rendered straight to React elements. Nothing
 * ever becomes raw HTML — there is no dangerouslySetInnerHTML anywhere in this file —
 * so a message body cannot inject markup no matter what it contains.
 */

import { Fragment, type ReactNode } from "react";
import type { CustomEmoji } from "@blob/shared";
import { resolveName } from "./emoji.ts";
import type { MentionTarget } from "../features/messages/mentionIndex.ts";

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
}

/** Block-level parse: fenced code, quotes, lists, paragraphs. */
export function renderMarkdown(
  source: string,
  options: RenderOptions,
): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
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
        <pre key={key++}>
          <code data-language={language || undefined}>{body.join("\n")}</code>
        </pre>,
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

    const bulletMatch = line.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] as string).match(/^[-*+]\s+(.*)$/);
        if (!match) break;
        items.push(match[1] as string);
        index += 1;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, options)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] as string).match(/^\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(match[1] as string);
        index += 1;
      }
      blocks.push(
        <ol key={key++}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, options)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (
        current.trim() === "" ||
        current.startsWith("```") ||
        current.startsWith("> ") ||
        /^[-*+]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push(
      <p key={key++}>{renderInline(paragraph.join("\n"), options)}</p>,
    );
  }

  return <>{blocks}</>;
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

  if (!earliest) return text;

  const { rule, match } = earliest;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  return (
    <>
      {before}
      {rule.render(match, options, 0)}
      {renderInline(after, options)}
    </>
  );
}
