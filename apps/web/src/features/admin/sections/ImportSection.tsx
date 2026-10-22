/** Admin → Import (ADR 0042): a Slack workspace's history, brought in.
 *
 * Four moments, one card each: choose the zip and watch it upload; read what is in it and
 * choose what comes; watch it run; and afterwards, invite the people who came over —
 * each invitation hands its person their account and their history. The zip goes from
 * this page straight to storage, never through the API, so its upload is an XHR for the
 * one thing `fetch` still cannot report: how far an upload has got.
 */

import { useEffect, useRef, useState } from 'react';
import { api, type ImportRecord, type ImportState, type ImportedPerson } from '../../../lib/api.ts';
import { formatBytes } from '../../../lib/format.ts';
import { showError, useToasts } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { putFile } from '../../../lib/putFile.ts';
import { Card, CardNotice } from '../../console/Card.tsx';

/** While something moves on the server, how often the page looks again. */
const POLL_MS = 2000;

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function ImportSection() {
  const { data: shown, reload } = useFetch(() => api.admin.importState(), [], {
    onError: showError,
  });
  const [upload, setUpload] = useState<{ name: string; sent: number; total: number } | null>(null);
  const current = shown?.current ?? null;

  // Watched while the worker has it, and only then.
  const moving = current?.status === 'reading' || current?.status === 'running';
  useEffect(() => {
    if (!moving) return undefined;
    const timer = window.setTimeout(reload, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [moving, shown, reload]);

  async function choose(file: File) {
    if (!shown) return;
    if (file.size > shown.maxBytes) {
      showError(new Error(`That file is larger than the ${formatBytes(shown.maxBytes)} this server takes.`));
      return;
    }
    setUpload({ name: file.name, sent: 0, total: file.size });
    try {
      const created = await api.admin.createImport(file.size);
      await putFile(created.uploadUrl, file, 'application/zip', (sent) =>
        setUpload((now) => (now ? { ...now, sent } : now)),
      );
      await api.admin.importUploaded(created.current.id);
    } catch (err) {
      showError(err);
    } finally {
      setUpload(null);
      reload();
    }
  }

  async function act(run: () => Promise<ImportState>) {
    try {
      await run();
    } catch (err) {
      showError(err);
    } finally {
      reload();
    }
  }

  if (!shown) return null;

  return (
    <div className="console-stack">
      {upload ? (
        <Card title="Uploading" description={upload.name}>
          <Meter value={upload.sent} max={upload.total} label="Uploaded">
            {formatBytes(upload.sent)} of {formatBytes(upload.total)}
          </Meter>
        </Card>
      ) : current?.status === 'reading' ? (
        <Card title="Reading the export" description="Checking the zip and counting what is in it.">
          <CardNotice>This takes a minute for a large workspace.</CardNotice>
        </Card>
      ) : current?.status === 'ready' && current.preview ? (
        <PreviewCard
          current={current}
          maxFileBytes={shown.maxFileBytes}
          onStart={(choices) => void act(() => api.admin.startImport(current.id, choices))}
          onDiscard={() => void act(() => api.admin.cancelImport(current.id))}
        />
      ) : current?.status === 'running' ? (
        <RunningCard current={current} onCancel={() => void act(() => api.admin.cancelImport(current.id))} />
      ) : (
        <>
          {current && current.status !== 'uploading' && <OutcomeCard current={current} />}
          {/* What to do next comes before starting over. */}
          {current?.status === 'done' && <PeopleCard importId={current.id} />}
          <ChooseCard
            again={current !== null && current.status !== 'uploading'}
            maxBytes={shown.maxBytes}
            onChoose={(file) => void choose(file)}
          />
        </>
      )}
    </div>
  );
}

function Meter({
  value,
  max,
  label,
  children,
}: {
  value: number;
  max: number;
  label: string;
  children: React.ReactNode;
}) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="import-meter">
      <progress className="import-meter-bar" value={share} max={1} aria-label={label} />
      <p className="pref-hint m-0">{children}</p>
    </div>
  );
}

function ChooseCard({
  again,
  maxBytes,
  onChoose,
}: {
  again: boolean;
  maxBytes: number;
  onChoose: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Card
      title={again ? 'Import another export' : 'Import from Slack'}
      description="Bring a Slack workspace’s history here: its channels, threads, reactions and files, each message still its writer’s."
    >
      <ol className="import-steps">
        <li>
          In Slack, open <strong>Workspace settings → Import/Export Data → Export</strong>, start an
          export and download the zip when Slack emails you.
        </li>
        <li>Choose the zip here. Nothing is written until you have seen what is in it.</li>
      </ol>
      <div className="console-form-actions">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
          Choose the zip
        </button>
        <input
          ref={input}
          type="file"
          name="export"
          aria-label="Slack export zip"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset, or choosing the same file twice in a row does nothing.
            event.target.value = '';
            if (file) onChoose(file);
          }}
        />
        <span className="pref-hint">Up to {formatBytes(maxBytes)}.</span>
      </div>
    </Card>
  );
}

function PreviewCard({
  current,
  maxFileBytes,
  onStart,
  onDiscard,
}: {
  current: ImportRecord;
  maxFileBytes: number;
  onStart: (choices: { includePrivate: boolean; copyFiles: boolean }) => void;
  onDiscard: () => void;
}) {
  const preview = current.preview!;
  const [includePrivate, setIncludePrivate] = useState(false);
  const [copyFiles, setCopyFiles] = useState(true);
  const privateCount = preview.privateChannels + preview.directMessages + preview.groupMessages;
  return (
    <Card title="What the export holds" description="Choose what comes, then start. You can leave this page while it runs.">
      <dl className="import-facts">
        <dt>Public channels</dt>
        <dd>
          {count(preview.publicChannels, 'channel', 'channels')}, {count(preview.publicDays, 'day', 'days')} of
          history
          {preview.merging.length > 0 && (
            <span className="pref-hint block">
              Merging into channels already here: {preview.merging.map((name) => `#${name}`).join(', ')}
            </span>
          )}
        </dd>
        <dt>People</dt>
        <dd>
          {count(preview.people, 'person', 'people')}: {preview.matched.toLocaleString()} already here,{' '}
          {preview.placeholders.toLocaleString()} arriving as names on their messages until you invite them
          {preview.withoutAddress > 0 && (
            <span className="pref-hint block">
              {count(preview.withoutAddress, 'person has', 'people have')} no address in the export
              and can’t be invited.
            </span>
          )}
        </dd>
        {preview.apps > 0 && (
          <>
            <dt>Apps</dt>
            <dd>{count(preview.apps, 'app', 'apps')}, kept as the names on their messages</dd>
          </>
        )}
      </dl>
      {privateCount > 0 && (
        <label className="pref-row">
          <span className="pref-label grow">
            Also bring private channels and direct messages
            <span className="pref-hint block">
              {count(preview.privateChannels, 'private channel', 'private channels')},{' '}
              {count(preview.directMessages + preview.groupMessages, 'direct message', 'direct messages')}.
              Only the people who were in each one will see it. You are not added to them.
            </span>
          </span>
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(event) => setIncludePrivate(event.target.checked)}
          />
        </label>
      )}
      <label className="pref-row">
        <span className="pref-label grow">
          Copy files
          <span className="pref-hint block">
            Up to {formatBytes(maxFileBytes)} each. A file that isn’t copied leaves a line in its
            message saying so.
          </span>
        </span>
        <input type="checkbox" checked={copyFiles} onChange={(event) => setCopyFiles(event.target.checked)} />
      </label>
      <div className="console-form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onStart({ includePrivate, copyFiles })}
        >
          Start import
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>
          Choose another file
        </button>
      </div>
    </Card>
  );
}

function RunningCard({ current, onCancel }: { current: ImportRecord; onCancel: () => void }) {
  const progress = current.progress;
  return (
    <Card
      title="Importing"
      description="It runs on the server, in steps. You can leave this page."
      footer={
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Stop import
        </button>
      }
    >
      <Meter value={progress.conversations} max={progress.conversationsTotal} label="Conversations imported">
        {progress.conversationsTotal > 0
          ? `${progress.conversations.toLocaleString()} of ${count(progress.conversationsTotal, 'conversation', 'conversations')}`
          : 'Finding everybody and every conversation'}
        {progress.messages > 0 && `, ${count(progress.messages, 'message', 'messages')}`}
        {progress.filesCopied > 0 && `, ${count(progress.filesCopied, 'file', 'files')} copied`}
      </Meter>
    </Card>
  );
}

function OutcomeCard({ current }: { current: ImportRecord }) {
  const progress = current.progress;
  const when = new Date(current.finishedAt ?? current.createdAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  if (current.status === 'failed') {
    return (
      <Card title="The last import didn’t finish" description={when}>
        <CardNotice>{current.error ?? 'It stopped.'}</CardNotice>
      </Card>
    );
  }
  if (current.status === 'cancelled') {
    return (
      <Card title="The last import was stopped" description={when}>
        <CardNotice>What it had written stays. Importing the same export again carries on from there.</CardNotice>
      </Card>
    );
  }
  return (
    <Card title="Imported" description={`${when}, by ${current.requestedByName}`}>
      <p className="m-0">
        {progress.messages === 0 && progress.conversationsTotal > 0 ? (
          // A second run of an export already in: it writes nothing twice (ADR 0042).
          'Everything in this export was already here.'
        ) : (
          <>
            {count(progress.messages, 'message', 'messages')} in{' '}
            {count(progress.conversationsTotal, 'conversation', 'conversations')}
            {progress.filesCopied > 0 &&
              `, ${count(progress.filesCopied, 'file', 'files')} copied`}
            .
          </>
        )}
      </p>
      {current.problems.length > 0 && (
        <details className="import-problems">
          <summary>{count(current.problems.length, 'thing', 'things')} didn’t come over</summary>
          <ul>
            {current.problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="pref-hint m-0">
        The export’s file links still work until you revoke them. Now that the files are here,
        revoke them on Slack’s export page.
      </p>
    </Card>
  );
}

function PeopleCard({ importId }: { importId: string }) {
  const { data, reload } = useFetch(() => api.admin.importPeople(importId), [importId], {
    onError: showError,
  });
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const people: ImportedPerson[] = data?.people ?? [];
  // Everybody not invited yet, until the admin says otherwise.
  const selected = chosen ?? new Set(people.filter((p) => !p.invited).map((p) => p.userId));

  async function invite() {
    setBusy(true);
    try {
      const { invited } = await api.admin.inviteImported(importId, [...selected]);
      useToasts.getState().push('info', `Invited ${count(invited, 'person', 'people')}.`);
      setChosen(null);
      reload();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  if (data && people.length === 0) return null;
  return (
    <Card
      title="Invite the people who came over"
      description="Each invitation goes to the address Slack had. Accepting it hands that person their account, with their messages and conversations."
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || selected.size === 0}
          onClick={() => void invite()}
        >
          {selected.size > 0 ? `Invite ${count(selected.size, 'person', 'people')}` : 'Invite'}
        </button>
      }
    >
      <ul className="import-people">
        {people.map((person) => (
          <li key={person.userId}>
            <label className="pref-row">
              <span className="pref-label grow">
                {person.name}
                <span className="pref-hint block">
                  {person.email}
                  {person.invited && ', invited'}
                </span>
              </span>
              <input
                type="checkbox"
                checked={selected.has(person.userId)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(person.userId);
                  else next.delete(person.userId);
                  setChosen(next);
                }}
              />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
