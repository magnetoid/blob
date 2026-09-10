/** Files posted in channels you can see, as a thumbnail grid.

The timeline already has thumbs. This tab is the place to look through them without
scrolling a year of chat, and it must never load the original until somebody opens one.
*/
import { useEffect, useState } from 'react';
import type { FileEntry } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { ImageLightbox } from './ImageLightbox.tsx';

export function FilesView() {
  const [items, setItems] = useState<FileEntry[] | null>(null);
  const [kind, setKind] = useState<'all' | 'image' | 'file'>('all');
  const [open, setOpen] = useState<FileEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void api.files
      .list({ kind })
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((err) => {
        if (!cancelled) {
          setItems([]);
          showError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
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
        <div className="empty-state">
          <div className="empty-state-title">Nothing here yet</div>
          <div className="empty-state-body">Files people post in channels will show up here.</div>
        </div>
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
