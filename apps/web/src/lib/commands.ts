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

/**
 * Commands the client answers itself.
 *
 * Every other command is the server's: it is POSTed to `/api/commands` and what comes
 * back is a message or a note. These have nothing to say and nothing to persist — they
 * open something on this screen — so a round trip would only be a slower way to reach
 * the same place, and the server would have to answer with an instruction to the client
 * rather than with a result.
 *
 * They are *offered* conditionally. `/cli` in a channel, or to somebody who could not
 * use it, is a command that autocompletes and then refuses, which teaches people the
 * feature is broken rather than that it is not for here.
 */
export interface LocalCommand extends CommandSpec {
  /** Whether to offer and accept it in the conversation currently open. */
  available: (context: LocalCommandContext) => boolean;
}

export interface LocalCommandContext {
  /** The bot this conversation is with, when it is a DM with one. */
  botUserId: string | null;
  /** Whether the person typing may open a terminal at all. */
  isAdmin: boolean;
}

export const LOCAL_COMMANDS: readonly LocalCommand[] = [
  {
    name: 'cli',
    usage: '',
    summary: 'Open a terminal in this agent',
    available: ({ botUserId, isAdmin }) => Boolean(botUserId) && isAdmin,
  },
];

/** The local command by that name, if it is one and it applies here. */
export function localCommand(
  name: string,
  context: LocalCommandContext,
): LocalCommand | null {
  return LOCAL_COMMANDS.find((c) => c.name === name && c.available(context)) ?? null;
}

/**
 * Autocomplete over both namespaces, local first.
 *
 * Local ones lead because they act on what is on screen: in a DM with an agent, `/cli`
 * is the more likely intent than a plugin command that happens to share the prefix.
 */
export function matchAllCommands(
  query: string,
  commands: readonly CommandSpec[],
  context: LocalCommandContext,
): CommandSpec[] {
  const local = LOCAL_COMMANDS.filter(
    (c) => c.available(context) && c.name.startsWith(query),
  );
  const remote = matchCommands(query, commands).filter(
    (c) => !local.some((l) => l.name === c.name),
  );
  return [...local, ...remote];
}
