/** An image, full size, without leaving the conversation.
 *
 * Clicking a picture used to open the original in a new tab: the browser's own image
 * viewer, a lost place in the channel, and a tab to close afterwards. Slack opens it in
 * place and Escape puts it away, which is what people's hands expect.
 *
 * The full original is what loads here — the thumbnail is for the timeline — so this is
 * also the only place the big bytes are fetched, which is the other half of what makes
 * a channel full of screenshots cheap to scroll.
 */

import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@blob/shared';
import { trapFocus } from '../../lib/focusTrap.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { CloseIcon } from '../../components/Icon.tsx';

interface Props {
  attachment: Attachment;
  onClose: () => void;
}

export function ImageLightbox({ attachment, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEscape(onClose);
  useEffect(() => trapFocus(dialogRef.current), []);

  return (
    <div
      className="dialog-backdrop lightbox-backdrop"
      role="presentation"
      onClick={(event) => {
        // The backdrop closes; the picture and its controls do not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="lightbox"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={attachment.filename}
      >
        <div className="lightbox-bar">
          <span className="lightbox-name">{attachment.filename}</span>
          <a
            className="btn btn-ghost"
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            download={attachment.filename}
          >
            Download
          </a>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size="md" />
          </button>
        </div>
        <img
          className="lightbox-image"
          src={attachment.url}
          alt={attachment.filename}
          width={attachment.width ?? undefined}
          height={attachment.height ?? undefined}
          data-loaded={loaded}
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
