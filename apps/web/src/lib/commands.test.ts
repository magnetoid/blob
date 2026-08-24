/**
 * The client's half of the command contract.
 *
 * `parseCommand` has to agree with `blob_api.services.commands.parse` about what counts
 * as a command. Where they disagree the failure is confusing rather than loud: the client
 * posts to `/api/commands` and the server answers "that isn't a command", or the client
 * sends a command as a message and it appears in the channel as text.
 *
 * `commandQuery` is narrower on purpose — it decides when to *offer* an autocomplete, and
 * offering one mid-sentence would put a listbox over the composer every time somebody
 * typed a path.
 */

import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '@blob/shared';
import { commandQuery, matchCommands, parseCommand } from './commands.ts';

const SPECS: CommandSpec[] = [
  { name: 'help', usage: '', summary: 'List the commands.' },
  { name: 'shrug', usage: '[text]', summary: 'Shrug.' },
  { name: 'shortcuts', usage: '', summary: 'Keyboard shortcuts.' },
  { name: 'topic', usage: '[text]', summary: 'Set the topic.' },
];

describe('parseCommand', () => {
  it('splits a name and its arguments', () => {
    expect(parseCommand('/topic release day')).toEqual({ name: 'topic', args: 'release day' });
  });

  it('reads a bare command as having no arguments', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', args: '' });
  });

  it('lowercases the name', () => {
    expect(parseCommand('/HELP')).toEqual({ name: 'help', args: '' });
  });

  it('is not fooled by ordinary text', () => {
    expect(parseCommand('just a message')).toBeNull();
    expect(parseCommand('and/or')).toBeNull();
  });

  it('treats a lone slash as text', () => {
    // Otherwise a message that is only a slash could never be sent.
    expect(parseCommand('/')).toBeNull();
    expect(parseCommand('/ leading space')).toBeNull();
  });

  it('treats a path as text', () => {
    expect(parseCommand('/usr/local/bin')).toBeNull();
  });

  it('keeps arguments intact, including extra whitespace inside them', () => {
    expect(parseCommand('/me waves   slowly')?.args).toBe('waves   slowly');
  });
});

describe('commandQuery', () => {
  it('offers an autocomplete as the name is typed', () => {
    expect(commandQuery('/')).toBe('');
    expect(commandQuery('/sh')).toBe('sh');
  });

  it('stops offering once the name is finished', () => {
    // The name is settled; what follows is an argument, not a command to pick.
    expect(commandQuery('/shrug ')).toBeNull();
    expect(commandQuery('/shrug it happens')).toBeNull();
  });

  it('never offers mid-sentence or on a second line', () => {
    expect(commandQuery('see /help')).toBeNull();
    expect(commandQuery('/help\nmore')).toBeNull();
  });

  it('does not offer for something that cannot be a name', () => {
    expect(commandQuery('/usr/local')).toBeNull();
  });
});

describe('matchCommands', () => {
  it('narrows by prefix', () => {
    expect(matchCommands('sh', SPECS).map((c) => c.name)).toEqual(['shrug', 'shortcuts']);
  });

  it('offers everything for an empty query', () => {
    expect(matchCommands('', SPECS)).toHaveLength(SPECS.length);
  });

  it('offers nothing when the prefix matches nothing', () => {
    expect(matchCommands('zzz', SPECS)).toEqual([]);
  });
});
