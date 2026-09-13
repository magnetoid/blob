/** The chips above the message field: what is attached, and how the upload is going. */

import type { PendingAttachment } from "../../lib/attachments.ts";
import { formatBytes } from "../../lib/format.ts";
import { CloseIcon, FileIcon } from "../../components/Icon.tsx";

export function AttachmentTray({
  attachments,
  onDiscard,
}: {
  attachments: PendingAttachment[];
  onDiscard: (key: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attachment-tray">
      {attachments.map((item) => (
        <li
          key={item.key}
          className="attachment-chip"
          data-status={item.status}
        >
          {item.previewUrl ? (
            <img
              className="attachment-chip-thumb"
              src={item.previewUrl}
              alt=""
            />
          ) : (
            <span className="attachment-chip-thumb" data-generic="true">
              <FileIcon size="md" />
            </span>
          )}
          <span className="attachment-chip-text">
            <span className="attachment-chip-name" title={item.filename}>
              {item.filename}
            </span>
            <span className="attachment-chip-meta">
              {item.status === "uploading" && "Uploading…"}
              {item.status === "ready" && formatBytes(item.sizeBytes)}
              {item.status === "failed" && (item.error ?? "Upload failed")}
            </span>
          </span>
          <button
            className="attachment-chip-remove"
            onClick={() => onDiscard(item.key)}
            title={`Remove ${item.filename}`}
          >
            <CloseIcon size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}
