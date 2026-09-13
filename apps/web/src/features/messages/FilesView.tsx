/** Files posted in channels you can see, as a thumbnail grid.

The timeline already has thumbs. This tab is the place to look through them without
scrolling a year of chat, and it must never load the original until somebody opens one.
*/
import { useState } from 'react';
import type { FileEntry } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { ImageLightbox } from './ImageLightbox.tsx';
import { useFetch } from '../../lib/useFetch.ts';
import { EmptyState } from '../../components/EmptyState.tsx';

export function FilesView() {
  const [kind, setKind] = useState<'all' | 'image' | 'file'>('all');
  const [open, setOpen] = useState<FileEntry | null>(null);
  const { data, loading } = useFetch(
    async (): Promise<FileEntry[]> => (await api.files.list({ kind })).items,
    [kind],
    { onError: showError },
  );
  // Null while a filter's request is out, so the grid does not show the last filter's
  // pictures under the new filter's name; an empty grid after a failure, as before.
  const items = loading ? null : (data ?? []);

  return (
    <main className="pane">
      <header className="pane-header">
        <div className="min-0">
          <div className="pane-heading">
            <h1 className="pane-title">Files</h1>
          </div>
          <div className="pane-sub">Pictures and files from channels you are in</div>
        </div>
      </header>

      <div className="chip-row" style={{ padding: '0 16px 8px' }}>
        {(
          [
            ['all', 'All'],
            ['image', 'Images'],
            ['file', 'Files'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="chip"
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="empty-state-body" style={{ padding: 16 }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing here yet">Files people post in channels will show up here.</EmptyState>
      ) : (
        <div className="files-grid">
          {items.map((item) => {
            const preview = item.thumbUrl ?? (item.mime.startsWith('image/') ? item.url : null);
            return (
              <button
                key={item.id}
                type="button"
                className="files-tile"
                onClick={() => setOpen(item)}
                aria-label={item.filename}
              >
                {preview ? (
                  <img src={preview} alt="" width={item.width ?? undefined} height={item.height ?? undefined} />
                ) : (
                  <span className="files-tile-name">{item.filename}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {open && <ImageLightbox attachment={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
