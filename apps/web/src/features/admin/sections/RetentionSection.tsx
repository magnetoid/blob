/** Admin → Retention (ADR 0039): how long messages and files are kept, and what a legal
 *  hold keeps past that.
 *
 * A window is chosen, shown with about what the first sweep would remove, and saved with
 * a confirmation — after which it waits a day before it counts, so a wrong choice can be
 * put back. Holds are placed on a conversation or a person and released with a word of
 * warning, because the next sweep may then reach what they kept.
 */

import { useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../../components/Dialog.tsx';
import { api, type RetentionPreview, type RetentionView } from '../../../lib/api.ts';
import { WINDOWS, windowLabel } from '../../../lib/retention.ts';
import { showError } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { Card, CardNotice } from '../../console/Card.tsx';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function amount(n: number, one: string, many: string, capped: boolean): string {
  if (capped && n >= 100_000) return `more than 100,000 ${many}`;
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function WindowSelect({
  id,
  hintId,
  value,
  unset,
  onChange,
}: {
  id: string;
  hintId: string;
  value: number | null;
  unset: string;
  onChange: (days: number | null) => void;
}) {
  const custom = value !== null && !WINDOWS.some((w) => w.days === value);
  return (
    <select
      id={id}
      className="input"
      aria-describedby={hintId}
      value={value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
    >
      <option value="">{unset}</option>
      {custom && <option value={String(value)}>{windowLabel(value)}</option>}
      {WINDOWS.map((w) => (
        <option key={w.days} value={String(w.days)}>
          {w.label}
        </option>
      ))}
    </select>
  );
}

/** Where the windows stand: waiting their day, when the sweep runs, what it last did. */
function standing(view: RetentionView): string[] {
  if (view.messageDays === null && view.fileDays === null) {
    return ['Blob keeps every message and file.'];
  }
  const lines: string[] = [];
  if (view.takesEffectAt && view.nextSweepAt) {
    lines.push(
      `Takes effect ${when(view.takesEffectAt)}; the first sweep under it runs ${when(view.nextSweepAt)}.`,
    );
  } else if (view.nextSweepAt) {
    lines.push(`The next sweep runs ${when(view.nextSweepAt)}.`);
  }
  if (view.lastSweep) {
    const { messages, files } = view.lastSweep;
    lines.push(
      messages + files === 0
        ? `The last sweep, ${when(view.lastSweep.at)}, found nothing past the line.`
        : `The last sweep, ${when(view.lastSweep.at)}, removed ${amount(messages, 'message', 'messages', false)} and ${amount(files, 'file', 'files', false)}.`,
    );
  }
  return lines;
}

function WindowsCard({ view, onSaved }: { view: RetentionView; onSaved: () => void }) {
  const messagesId = useId();
  const messagesHint = useId();
  const filesId = useId();
  const filesHint = useId();
  // A draft over what is saved; undefined is "as saved".
  const [messages, setMessages] = useState<number | null | undefined>(undefined);
  const [files, setFiles] = useState<number | null | undefined>(undefined);
  const [preview, setPreview] = useState<(RetentionPreview & { key: string }) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const draftMessages = messages === undefined ? view.messageDays : messages;
  const draftFiles = files === undefined ? view.fileDays : files;
  const changed = draftMessages !== view.messageDays || draftFiles !== view.fileDays;
  const removes = draftMessages !== null || draftFiles !== null;
  const key = `${draftMessages}:${draftFiles}`;

  // About what the draft would take, counted a moment after it settles.
  useEffect(() => {
    if (!changed || !removes) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      api.admin
        .retentionPreview({ messageDays: draftMessages, fileDays: draftFiles })
        .then((counted) => {
          if (live) setPreview({ ...counted, key });
        })
        .catch(() => {
          if (live) setPreview(null);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [changed, removes, draftMessages, draftFiles, key]);

  const counted = preview?.key === key ? preview : null;

  async function save() {
    setSaving(true);
    try {
      await api.admin.setRetention({ messageDays: draftMessages, fileDays: draftFiles });
      setMessages(undefined);
      setFiles(undefined);
      onSaved();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="How long things are kept"
      description="Past the line, a nightly sweep removes a message the way a delete does — its words, reactions, files and preview — and a thread keeps its shape. Tasks and decisions stay. A change waits a day before it counts, so a wrong choice can be put back."
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={!changed || saving}
          onClick={() => (removes ? setConfirming(true) : void save())}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div className="pref-row">
        <div className="grow">
          <label className="pref-label" htmlFor={messagesId}>
            Messages
          </label>
          <div className="pref-hint" id={messagesHint}>
            How long a message is kept after it is sent.
          </div>
        </div>
        <WindowSelect
          id={messagesId}
          hintId={messagesHint}
          value={draftMessages}
          unset="Keep forever"
          onChange={setMessages}
        />
      </div>
      <div className="pref-row">
        <div className="grow">
          <label className="pref-label" htmlFor={filesId}>
            Files
          </label>
          <div className="pref-hint" id={filesHint}>
            A shorter window removes files sooner and keeps the words. A file never outlives
            its message.
          </div>
        </div>
        <WindowSelect
          id={filesId}
          hintId={filesHint}
          value={draftFiles}
          unset="With their messages"
          onChange={setFiles}
        />
      </div>
      <div className="retention-standing" aria-live="polite">
        {changed ? (
          <p className="pref-hint m-0">
            {!removes
              ? 'Nothing will be removed.'
              : counted
                ? `The first sweep would remove about ${amount(counted.messages, 'message', 'messages', counted.capped)} and ${amount(counted.files, 'file', 'files', counted.capped)}.`
                : 'Counting what the first sweep would remove…'}
          </p>
        ) : (
          standing(view).map((line) => (
            <p key={line} className="pref-hint m-0">
              {line}
            </p>
          ))
        )}
      </div>

      <DialogPresence when={confirming || null}>
        {() => (
          <ConfirmDialog
            title="Remove history past these windows?"
            body={`${
              counted
                ? `The first sweep would remove about ${amount(counted.messages, 'message', 'messages', counted.capped)} and ${amount(counted.files, 'file', 'files', counted.capped)}, and every night after it removes what crosses the line. `
                : 'Every night the sweep removes what has crossed the line. '
            }Nothing goes for a day, so you can change this back until then; after that it cannot be undone.`}
            confirmLabel="Save"
            danger
            onClose={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void save();
            }}
          />
        )}
      </DialogPresence>
    </Card>
  );
}

type Release = { kind: 'conversation' | 'person'; id: string; label: string };

function HoldsCard({ view, onChanged }: { view: RetentionView; onChanged: () => void }) {
  const conversationId = useId();
  const personId = useId();
  const channels = useFetch(() => api.admin.channels(), [], { onError: showError });
  const people = useFetch(() => api.admin.users({ includeDeactivated: false }), [], {
    onError: showError,
  });
  const [conversation, setConversation] = useState('');
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState<Release | null>(null);

  const held = new Set([
    ...view.heldConversations.map((c) => c.id),
    ...view.heldPeople.map((p) => p.id),
  ]);
  const conversations = (channels.data?.channels ?? []).filter(
    (c) => (c.kind === 'public' || c.kind === 'private') && !held.has(c.id),
  );
  const folks = (people.data?.users ?? []).filter((u) => !held.has(u.id));

  async function hold(kind: Release['kind'], id: string, on: boolean) {
    setBusy(true);
    try {
      await (kind === 'conversation'
        ? api.admin.holdConversation(id, on)
        : api.admin.holdPerson(id, on));
      if (kind === 'conversation') setConversation('');
      else setPerson('');
      onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  const nothingHeld = view.heldConversations.length === 0 && view.heldPeople.length === 0;

  return (
    <Card
      title="Legal holds"
      description="A conversation on hold, every conversation a person on hold is in, and everything that person wrote are kept past the windows above. A hold does not stop people deleting their own messages, and keeps nothing they deleted."
    >
      {nothingHeld ? (
        <CardNotice>Nothing is on hold.</CardNotice>
      ) : (
        <ul className="hold-list" aria-label="On hold">
          {view.heldConversations.map((c) => {
            const label = c.name ? `#${c.name}` : 'A direct message';
            return (
              <li key={c.id} className="hold-row">
                <span className="grow">
                  <span className="pref-label">{label}</span>
                  <span className="pref-hint block">
                    Since {when(c.heldAt)}
                    {c.heldBy ? `, placed by ${c.heldBy}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Release the hold on ${label}`}
                  onClick={() => setReleasing({ kind: 'conversation', id: c.id, label })}
                >
                  Release
                </button>
              </li>
            );
          })}
          {view.heldPeople.map((p) => (
            <li key={p.id} className="hold-row">
              <span className="grow">
                <span className="pref-label">{p.displayName}</span>
                <span className="pref-hint block">
                  Everything they are in, since {when(p.heldAt)}
                  {p.heldBy ? `, placed by ${p.heldBy}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Release the hold on ${p.displayName}`}
                onClick={() => setReleasing({ kind: 'person', id: p.id, label: p.displayName })}
              >
                Release
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pref-row">
        <label className="grow pref-label" htmlFor={conversationId}>
          Hold a conversation
        </label>
        <select
          id={conversationId}
          className="input"
          value={conversation}
          onChange={(event) => setConversation(event.target.value)}
        >
          <option value="">Choose a channel</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
              {c.kind === 'private' ? ' (private)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!conversation || busy}
          onClick={() => void hold('conversation', conversation, true)}
        >
          Hold
        </button>
      </div>
      <div className="pref-row">
        <label className="grow pref-label" htmlFor={personId}>
          Hold a person
        </label>
        <select
          id={personId}
          className="input"
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          <option value="">Choose someone</option>
          {folks.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!person || busy}
          onClick={() => void hold('person', person, true)}
        >
          Hold
        </button>
      </div>

      <DialogPresence when={releasing}>
        {(release) => (
          <ConfirmDialog
            title={`Release the hold on ${release.label}?`}
            body="The next sweep may remove what the hold kept that is past the windows."
            confirmLabel="Release"
            danger
            onClose={() => setReleasing(null)}
            onConfirm={() => {
              setReleasing(null);
              void hold(release.kind, release.id, false);
            }}
          />
        )}
      </DialogPresence>
    </Card>
  );
}

export function RetentionSection() {
  const { data, reload } = useFetch(() => api.admin.retention(), [], { onError: showError });
  if (!data) {
    return (
      <div className="console-stack">
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      </div>
    );
  }
  return (
    <div className="console-stack">
      <WindowsCard view={data} onSaved={reload} />
      <HoldsCard view={data} onChanged={reload} />
    </div>
  );
}
