/** Errors the client threw in people's browsers here (ADR 0025's addendum): once per fault,
 *  newest seen first, with how often, where and in what. The server cut each report down
 *  before keeping it, so there is no address, id or query string here to read. */

import { useState } from 'react';
import { api } from '../../../../lib/api.ts';
import { showError } from '../../../../lib/toasts.ts';
import { useFetch } from '../../../../lib/useFetch.ts';
import { formatRelative } from '../../../messages/messageFormatting.ts';
import { Card, CardNotice } from '../../../console/Card.tsx';

export function BrowserErrors() {
  const { data, reload } = useFetch(() => api.admin.clientErrors(), [], { onError: showError });
  const [clearing, setClearing] = useState(false);
  const errors = data?.errors ?? [];

  async function clear() {
    setClearing(true);
    try {
      await api.admin.clearClientErrors();
      reload();
    } catch (err) {
      showError(err);
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card
      title="Errors in browsers"
      description="What the client threw in people’s browsers here, once per fault. Addresses, ids and query strings are taken out before anything is kept, and a fault is forgotten thirty days after it was last seen."
      actions={
        errors.length > 0 ? (
          <button type="button" className="btn" disabled={clearing} onClick={() => void clear()}>
            Clear
          </button>
        ) : undefined
      }
    >
      {data === null ? (
        <CardNotice>Loading…</CardNotice>
      ) : errors.length === 0 ? (
        <CardNotice>No browser has reported an error.</CardNotice>
      ) : (
        <ul className="hold-list" aria-label="Errors in browsers">
          {errors.map((fault) => (
            <li key={fault.fingerprint} className="browser-error">
              <details>
                <summary>
                  <span className="pref-label">{fault.message}</span>
                  <span className="pref-hint block">
                    {fault.count === 1 ? 'Once' : `${fault.count} times`}, last{' '}
                    {formatRelative(fault.lastAt)} · {fault.browser} · {fault.path || '/'}
                    {fault.release ? ` · build ${fault.release}` : ''}
                  </span>
                </summary>
                {fault.stack && <pre className="browser-error-stack">{fault.stack}</pre>}
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
