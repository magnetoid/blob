/**
 * Slash commands, client side.
 *
 * The server owns the namespace — what commands exist arrives on bootstrap, and dispatch
 * is a request to `/api/commands`. What lives here is only what the composer needs before
 * that request: whether the thing being typed *looks* like a command, and which of the
 * known ones to offer while it is half-typed.
 *
 * `parseCommand` deliberately mirrors `blob_api.services.commands.parse`, the same way
 * `mentions.ts` mirrors `lib/mentions.py`. The two must agree on what counts as a
 * command, or the client sends something the server refuses as not-a-command at all.
 */

import type { CommandSpec } from '@blob/shared';

export interface ParsedCommand {
  name: string;
  /** Everything after the name, trimmed. Empty when there was nothing. */
  args: string;
}

/** Only letters, digits, `_` and `-` make a command name. */
const NAME_RE = /^[a-z0-9_-]+$/;

/**
 * Split `/name rest`, or return null when this is not a command.
 *
 * A lone `/` and a leading `/ ` are both not commands: far more often someone is typing
 * a path, and treating them as commands would make a message starting with a slash
 * impossible to send.
 */
export function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith('/')) return null;

  const rest = text.slice(1);
  const space = rest.indexOf(' ');
  const name = (space === -1 ? rest : rest.slice(0, space)).trim().toLowerCase();
  if (!name || !NAME_RE.test(name)) return null;

  return { name, args: space === -1 ? '' : rest.slice(space + 1).trim() };
}

/**
 * The partial name to autocomplete, or null when the composer is not naming a command.
 *
 * Only ever the *first* token of the *first* line: `/` in the middle of a sentence is a
 * slash, and a second line means the command name is already settled.
 */
export function commandQuery(draft: string): string | null {
  if (!draft.startsWith('/')) return null;
  if (draft.includes('\n')) return null;

  const head = draft.slice(1);
  if (head.includes(' ')) return null;
  if (head && !NAME_RE.test(head.toLowerCase())) return null;

  return head.toLowerCase();
}

/** Known commands whose name starts with the partial one, in the order given. */
export function matchCommands(query: string, commands: readonly CommandSpec[]): CommandSpec[] {
  return commands.filter((c) => c.name.startsWith(query));
}
