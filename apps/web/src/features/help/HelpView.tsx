/** Help — what everything on this screen is, and how to use it.
 *
 * Reached from the account menu. Slack answers this question by sending you to a help
 * centre on another domain, which is the wrong shape for something self-hosted: that
 * page describes Slack's build of Slack, and this one has to describe *your* build of
 * Blob, with the commands your apps installed and the sections your role can open. So it
 * ships in the bundle, and it reads the running app rather than being written about it.
 *
 * Three sources, and only one of them is prose. The keyboard section is `SHORTCUTS`, the
 * command section is what the server sent on bootstrap, and `lib/help.ts` holds the rest
 * — behaviour, which no registry can generate. A topic that mentions a key or a command
 * names it by id and gets the real one back, so the page cannot document a binding
 * nobody implemented.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store.ts';
import { navigate } from '../../lib/router.ts';
import type { CommandSpec } from '@blob/shared';
import { SECTIONS, topicMatches, type Section, type Topic } from '../../lib/help.ts';
import { LOCAL_COMMANDS } from '../../lib/commands.ts';
import {
  SHORTCUTS,
  chordsFor,
  describeKeys,
  groupedShortcuts,
  isMac,
  type Shortcut,
} from '../../lib/shortcuts.ts';

/** The keys for one shortcut, or nothing when the id names no binding. */
function Keys({ id, mac }: { id: string; mac: boolean }) {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) return null;
  return (
    <span className="help-keys">
      {chordsFor(shortcut).map((chord, index) => (
        <span key={index} className="shortcut-chord">
          {index > 0 && <span className="shortcut-or">or</span>}
          {describeKeys(chord, mac).map((cap) => (
            <kbd key={cap}>{cap}</kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

function ShortcutRow({ shortcut, mac }: { shortcut: Shortcut; mac: boolean }) {
  return (
    <div className="shortcut-row">
      <span>{shortcut.label}</span>
      <span className="shortcut-keys">
        {chordsFor(shortcut).map((chord, index) => (
          <span key={index} className="shortcut-chord">
            {index > 0 && <span className="shortcut-or">or</span>}
            {describeKeys(chord, mac).map((cap) => (
              <kbd key={cap}>{cap}</kbd>
            ))}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Every command this workspace knows, local ones first, then the server's.
 *
 * The local ones never reach the server, so bootstrap has never heard of them. They are
 * still commands somebody can type, so the page that lists commands lists them.
 */
function commandRows(commands: readonly CommandSpec[]): CommandSpec[] {
  const local: CommandSpec[] = LOCAL_COMMANDS.map((c) => ({
    name: c.name,
    usage: c.usage,
    summary: c.summary,
  }));
  const known = new Set(local.map((c) => c.name));
  return [...local, ...commands.filter((c) => !known.has(c.name))].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function commandMatches(command: CommandSpec, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `/${command.name} ${command.usage} ${command.summary}`.toLowerCase().includes(q);
}

/** Every command this server answers, as it described them itself. */
function CommandTable({ query }: { query: string }) {
  const commands = useStore((s) => s.commands);

  const rows = useMemo(() => commandRows(commands), [commands]);
  const shown = rows.filter((c) => commandMatches(c, query));

  if (rows.length === 0) {
    return (
      <p className="muted">
        This server has not told the app about any commands yet. Reload the page if it has
        just started.
      </p>
    );
  }

  return (
    <div className="help-commands">
      {shown.map((command) => (
        <div key={command.name} className="help-command">
          <code className="help-command-name">
            /{command.name}
            {command.usage && <span className="help-command-usage"> {command.usage}</span>}
          </code>
          <span className="help-command-summary">{command.summary}</span>
        </div>
      ))}
      {shown.length === 0 && <p className="muted">No command matches “{query}”.</p>}
    </div>
  );
}

function TopicBlock({ topic, mac, canOpen }: { topic: Topic; mac: boolean; canOpen: boolean }) {
  const commands = useStore((s) => s.commands);

  return (
    <article className="help-topic" id={topic.id}>
      <h3 className="help-topic-title">
        {topic.title}
        {topic.audience && (
          <span className="help-audience">
            {topic.audience === 'owner' ? 'Server owner' : 'Admins'}
          </span>
        )}
      </h3>
      <p className="help-blurb">{topic.blurb}</p>

      {topic.body?.map((paragraph, index) => (
        <p key={index} className="help-para">
          {paragraph}
        </p>
      ))}

      {topic.steps && (
        <ol className="help-steps">
          {topic.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}

      {(topic.shortcuts?.length || topic.commands?.length || topic.path) && (
        <div className="help-refs">
          {topic.shortcuts?.map((id) => <Keys key={id} id={id} mac={mac} />)}
          {topic.commands?.map((name) => {
            const spec = commands.find((c) => c.name === name);
            return (
              <code key={name} className="help-ref-command" title={spec?.summary}>
                /{name}
              </code>
            );
          })}
          {/* A link only where the reader may actually open it. Offering an admin a
              route to the owner's console is how the account menu used to hand people a
              page whose every request answers 403. */}
          {topic.path &&
            (canOpen ? (
              <button
                type="button"
                className="help-ref-link"
                onClick={() => navigate(topic.path as string)}
              >
                Open {topic.path}
              </button>
            ) : (
              <span className="help-ref-path">{topic.path}</span>
            ))}
        </div>
      )}
    </article>
  );
}

export function HelpView() {
  const [query, setQuery] = useState('');
  const currentUser = useStore((s) => s.currentUser);
  // Read here as well as in the table: whether the command section survives a filter is
  // a question about the rows in it, and an app's own command is named by no topic at
  // all — filtering on the prose alone made it unfindable by the only name it has.
  const commands = useStore((s) => s.commands);
  const mac = isMac();

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const isOwner = currentUser?.role === 'owner';
  const mayOpen = (topic: Topic): boolean =>
    topic.audience === 'owner' ? isOwner : topic.audience === 'admins' ? isAdmin : true;

  // Somebody arrives here with a link to one topic — from a message, from the shortcut
  // dialog. The browser cannot honour the fragment itself because this view is loaded
  // lazily and is not in the document when the hash is read.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  const visible: Section[] = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        topics: section.topics.filter((topic) => topicMatches(topic, query)),
      })).filter(
        (section) =>
          section.topics.length > 0 ||
          // A generated section keeps its place while filtering: the shortcut and
          // command lists do their own matching, and dropping them here would make
          // searching for "topic" hide the /topic command.
          (section.generated !== undefined && matchesGenerated(section, query, mac, commands)),
      ),
    [query, mac, commands],
  );

  const matches = visible.reduce((count, section) => count + section.topics.length, 0);

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Help</h1>
          </div>
          <div className="pane-sub">How Blob works, and how to use it</div>
        </div>
      </header>

      <div className="help">
        <nav className="help-toc" aria-label="Guide sections">
          {visible.map((section) => (
            <a key={section.id} className="help-toc-link" href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <div className="help-body">
          <div className="help-search">
            <input
              type="search"
              className="input help-search-input"
              placeholder="Search the guide"
              aria-label="Search the guide"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* Announced, because filtering a page this long moves content the reader
                cannot see from where the cursor is. */}
            <span className="help-search-count muted" role="status">
              {query.trim() ? `${matches} ${matches === 1 ? 'topic' : 'topics'} match` : ''}
            </span>
          </div>

          {visible.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">Nothing here says that</div>
              <div className="empty-state-body">
                Try a plainer word — “thread”, “unread”, “schedule”. If the answer really
                is missing, Feedback in the account menu goes straight to the people who
                can add it.
              </div>
            </div>
          )}

          {visible.map((section) => (
            <section key={section.id} className="help-section" id={section.id}>
              <h2 className="help-section-title">{section.title}</h2>
              <p className="help-section-intro">{section.intro}</p>

              {section.topics.map((topic) => (
                <TopicBlock key={topic.id} topic={topic} mac={mac} canOpen={mayOpen(topic)} />
              ))}

              {section.generated === 'commands' && <CommandTable query={query} />}

              {section.generated === 'shortcuts' &&
                groupedShortcuts().map(([group, shortcuts]) => {
                  const shown = shortcuts.filter((s) => matchesShortcut(s, query, mac));
                  if (shown.length === 0) return null;
                  return (
                    <div key={group} className="shortcut-group">
                      <h3 className="section-label">{group}</h3>
                      {shown.map((shortcut) => (
                        <ShortcutRow key={shortcut.id} shortcut={shortcut} mac={mac} />
                      ))}
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

/** Whether a shortcut's label or its keys contain what was typed. */
function matchesShortcut(shortcut: Shortcut, query: string, mac: boolean): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const keys = chordsFor(shortcut)
    .flatMap((chord) => describeKeys(chord, mac))
    .join(' ')
    .toLowerCase();
  return `${shortcut.label} ${shortcut.group} ${keys}`.toLowerCase().includes(q);
}

/** Whether a generated section still has anything to show under this filter. */
function matchesGenerated(
  section: Section,
  query: string,
  mac: boolean,
  commands: readonly CommandSpec[],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (section.generated === 'shortcuts') {
    return SHORTCUTS.some((shortcut) => matchesShortcut(shortcut, q, mac));
  }
  if (`${section.title} ${section.intro}`.toLowerCase().includes(q)) return true;
  return commandRows(commands).some((command) => commandMatches(command, q));
}
