/** The files waiting in the composer's tray, and how they get there.
 *
 * Uploads start the moment a file is chosen, pasted or dropped; the message sends the
 * ids of the ones that finished. Object URLs for image previews are revoked when the
 * composer goes away — not doing so leaks the whole file for the life of the tab.
 */

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  newPendingAttachment,
  uploadFile,
  type PendingAttachment,
} from "../../lib/attachments.ts";

export function useAttachments(onError: (message: string | null) => void): {
  attachments: PendingAttachment[];
  attach: (files: File[]) => void;
  discard: (key: string) => void;
  clear: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  dragging: boolean;
  setDragging: (dragging: boolean) => void;
} {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);

  // Read through a ref rather than the closure. The effect runs once, so its cleanup
  // captured `attachments` as it was on mount — always empty — and the one path it was
  // written for was the one path that revoked nothing. The ref is read at unmount, so it
  // sees whatever is actually in the tray.
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
    // Deliberately on unmount only: revoking on every change would kill live previews.
  }, []);

  function update(key: string, patch: Partial<PendingAttachment>) {
    setAttachments((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function discard(key: string) {
    setAttachments((current) => {
      const going = current.find((item) => item.key === key);
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  /** Empty the tray without revoking: the message that carries them is on its way. */
  function clear() {
    for (const item of attachmentsRef.current) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setAttachments([]);
  }

  function attach(files: File[]) {
    if (files.length === 0) return;
    onError(null);

    const room = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (room <= 0) {
      onError(
        `A message can carry ${MAX_ATTACHMENTS_PER_MESSAGE} files at most.`,
      );
      return;
    }
    if (files.length > room) {
      onError(`Only the first ${room} of those fit on this message.`);
    }

    for (const file of files.slice(0, room)) {
      const pending = newPendingAttachment(file);
      setAttachments((current) => [...current, pending]);

      void uploadFile(file, pending.mime)
        .then((attachmentId) =>
          update(pending.key, { attachmentId, status: "ready" }),
        )
        .catch((err: unknown) => {
          const message =
            err instanceof Error
              ? err.message
              : "That file could not be uploaded.";
          update(pending.key, { status: "failed", error: message });
        });
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    // A pasted screenshot arrives as a file with no name the user chose. Text pastes
    // carry no files, so this never interferes with ordinary copy and paste.
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attach(files);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    attach(Array.from(event.dataTransfer.files));
  }

  return {
    attachments,
    attach,
    discard,
    clear,
    onPaste,
    onDrop,
    dragging,
    setDragging,
  };
}
