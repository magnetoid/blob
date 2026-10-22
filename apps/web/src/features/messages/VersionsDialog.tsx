/** A message's earlier words, as a legal hold kept them (ADR 0039 addendum), for an admin.
 *
 * Kept only while the conversation, or the message's writer, is on legal hold — the two
 * holds the writer is shown — and only readable where the admin may read the conversation
 * at all. The words are shown as written, not rendered: this is a record, and a record of
 * markdown is its characters.
 */

import { api, type KeptVersions } from '../../lib/api.ts';
import { formatMoment } from '../../lib/format.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { Dialog } from '../../components/Dialog.tsx';

export function VersionsDialog({
  messageId,
  current,
  onClose,
}: {
  messageId: string;
  /** What the message says now. */
  current: string;
  onClose: () => void;
}) {
  const { data, error } = useFetch<KeptVersions>(
    () => api.admin.messageVersions(messageId),
    [messageId],
  );
  return (
    <Dialog label="Earlier versions" onClose={onClose}>
      <div className="dialog versions-dialog">
        <h2 className="dialog-title">Earlier versions</h2>
        {error && <p className="error-text">{error.message}</p>}
        {data && data.versions.length === 0 && (
          <p className="muted">
            None were kept. A message’s earlier words are kept only while its conversation,
            or the person who wrote it, is on legal hold.
          </p>
        )}
        {data && data.versions.length > 0 && (
          <ol className="versions-list">
            {data.versions.map((version, index) => (
              <li key={`${version.writtenAt}-${index}`}>
                <p className="versions-when">
                  Written {formatMoment(version.writtenAt)}, replaced{' '}
                  {formatMoment(version.replacedAt)}
                </p>
                <p className="versions-body">{version.body}</p>
              </li>
            ))}
            <li>
              <p className="versions-when">Now</p>
              <p className="versions-body">{current}</p>
            </li>
          </ol>
        )}
        {data && (
          <p className="pref-hint m-0">
            {data.held
              ? 'On legal hold: an edit now keeps the words it replaces.'
              : 'Not on legal hold now: an edit now keeps nothing.'}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
