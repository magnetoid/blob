/**
 * Message rendering.
 *
 * A deliberately small Markdown subset rendered straight to React elements. Nothing
 * ever becomes raw HTML — there is no dangerouslySetInnerHTML anywhere in this file —
 * so a message body cannot inject markup no matter what it contains.
 */

import { Fragment, type ReactNode } from 'react';

export interface RenderOptions {
  /** Lowercased display name → user id, for highlighting mentions. */
  knownNames: Map<string, string>;
  currentUserId: string | null;
}

/** Block-level parse: fenced code, quotes, lists, paragraphs. */
export function renderMarkdown(source: string, options: RenderOptions): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = source.split('\n');
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index] as string;

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] as string).startsWith('```')) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push(
        <pre key={key++}>
          <code data-language={language || undefined}>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.startsWith('> ')) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] as string).startsWith('> ')) {
        body.push((lines[index] as string).slice(2));
        index += 1;
      }
      blocks.push(
        <blockquote key={key++}>{renderInline(body.join('\n'), options)}</blockquote>,
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

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] as string;
      if (
        current.trim() === '' ||
        current.startsWith('```') ||
        current.startsWith('> ') ||
        /^[-*+]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push(<p key={key++}>{renderInline(paragraph.join('\n'), options)}</p>);
  }

  return <>{blocks}</>;
}

type InlineRule = {
  pattern: RegExp;
  render: (match: RegExpExecArray, options: RenderOptions, key: number) => ReactNode;
};

const INLINE_RULES: InlineRule[] = [
  // Code first: its contents must not be parsed further.
  {
    pattern: /`([^`\n]+)`/,
    render: (m, _o, key) => <code key={key}>{m[1]}</code>,
  },
  {
    pattern: /\*\*([^*\n]+)\*\*/,
    render: (m, o, key) => <strong key={key}>{renderInline(m[1] as string, o)}</strong>,
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
    render: (m, o, key) => <del key={key}>{renderInline(m[1] as string, o)}</del>,
  },
  {
    pattern: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    render: (m, _o, key) => (
      <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  {
    pattern: /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/,
    render: (m, _o, key) => (
      <a key={key} href={m[1]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  {
    // Mentions: only render as a mention if the name is one we know.
    pattern: /@([\p{L}\p{N}][\p{L}\p{N}._'-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._'-]*)?)/u,
    render: (m, o, key) => {
      const raw = m[1] as string;
      const candidates = [raw, raw.split(/\s+/)[0] as string];
      for (const candidate of candidates) {
        const bare = candidate.replace(/[.,!?;:]+$/, '');
        const id = o.knownNames.get(bare.toLowerCase());
        if (id) {
          const rest = raw.slice(bare.length);
          return (
            <Fragment key={key}>
              <span className="mention" data-me={id === o.currentUserId}>
                @{bare}
              </span>
              {rest}
            </Fragment>
          );
        }
      }
      const token = raw.toLowerCase();
      if (token === 'channel' || token === 'here' || token === 'everyone') {
        return (
          <span key={key} className="mention" data-me="true">
            @{raw}
          </span>
        );
      }
      return <Fragment key={key}>@{raw}</Fragment>;
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
