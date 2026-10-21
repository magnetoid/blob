/** Exports (M3 · B4): ask for one, watch it build, download it.
 *
 * The same card on two pages with two scopes: an admin's workspace export (its public
 * conversations, never a private channel or a DM) and a person's own (everything they are
 * in). Either asks the person to have signed in recently — the step-up prompt answers that
 * on its own (`lib/stepUp.ts`) — and the list watches itself while something is building.
 */

import { useEffect, useState } from 'react';
import { api, type ExportEntry } from '../../lib/api.ts';
import { formatBytes } from '../../lib/format.ts';
import { showError } from '../../lib/toasts.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { Card } from './Card.tsx';

const STATUS: Record<ExportEntry['status'], string> = {
  pending: 'Waiting to start',
  running: 'Building…',
  done: 'Ready',
  failed: 'Failed',
};

/** "Ready, 2.1 MB", "Failed: the bucket is gone", and for a workspace one, whose it is. */
function describe(item: ExportEntry, scope: 'workspace' | 'personal'): string {
  const parts = [
    item.status === 'failed' && item.error
      ? `${STATUS.failed}: ${item.error}`
      : STATUS[item.status],
  ];
  if (item.status === 'done' && item.bytes !== null) parts.push(formatBytes(item.bytes));
  if (scope === 'workspace') parts.push(`asked for by ${item.requestedByName}`);
  return parts.join(', ');
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ExportsCard({
  scope,
  title,
  description,
}: {
  scope: 'workspace' | 'personal';
  title: string;
  description: string;
}) {
  const [busy, setBusy] = useState(false);
  const { data, reload } = useFetch(
    async () => (scope === 'workspace' ? api.admin.exports() : api.me.exports()),
    [scope],
    { onError: showError },
  );
  const items = data?.exports ?? [];
  const building = items.some((item) => item.status === 'pending' || item.status === 'running');

  // Watched while something is building, and only then.
  useEffect(() => {
    if (!building) return undefined;
    const timer = window.setTimeout(reload, 3000);
    return () => window.clearTimeout(timer);
  }, [building, data, reload]);

  async function start() {
    setBusy(true);
    try {
      await (scope === 'workspace' ? api.admin.startExport() : api.me.startExport());
      reload();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={title}
      description={description}
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || building}
          onClick={() => void start()}
        >
          {building ? 'Building…' : 'Export'}
        </button>
      }
    >
      {items.length === 0 ? (
        <p className="muted m-0">Nothing exported yet. An export is kept for a week.</p>
      ) : (
        <ul className="export-list">
          {items.map((item) => (
            <li key={item.id} className="export-row">
              <span className="grow">
                <span className="pref-label">{when(item.createdAt)}</span>
                <span className="pref-hint block">{describe(item, scope)}</span>
              </span>
              {item.downloadUrl && (
                <a className="btn" href={item.downloadUrl}>
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
