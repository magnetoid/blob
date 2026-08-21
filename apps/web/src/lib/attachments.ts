/** Uploading a file, from a File to an attachment id the composer can send.
 *
 * Three steps, and the bytes never touch the API process: ask for a ticket, PUT
 * straight to object storage, then tell the server it landed. The upload runs when the
 * file is chosen rather than when the message is sent, so pressing Enter is instant and
 * a slow upload blocks nothing else.
 */

import { api } from './api.ts';

/** Matches the server's cap in UploadRequestInput. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Matches the server's max_length on attachmentIds. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export interface PendingAttachment {
  /** Local until the ticket comes back; the attachment id after that. */
  key: string;
  attachmentId: string | null;
  filename: string;
  sizeBytes: number;
  mime: string;
  /** An object URL for images, so the composer previews what is being sent. */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
  error: string | null;
}

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function newPendingAttachment(file: File): PendingAttachment {
  return {
    key: crypto.randomUUID(),
    attachmentId: null,
    filename: file.name,
    sizeBytes: file.size,
    // Some browsers hand over an empty type for unusual extensions, and the server
    // requires a non-empty mime.
    mime: file.type || 'application/octet-stream',
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    status: 'uploading',
    error: null,
  };
}

/**
 * Runs the three steps and returns the attachment id.
 *
 * The PUT goes to object storage directly, so it is a bare fetch rather than an `api`
 * call: no session cookie belongs on that request, and the URL is already signed.
 */
export async function uploadFile(file: File, mime: string): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Files have to be under ${describeSize(MAX_UPLOAD_BYTES)}.`);
  }

  const ticket = await api.uploads.create({
    filename: file.name,
    mime,
    sizeBytes: file.size,
  });

  const response = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: ticket.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error('That file could not be uploaded.');
  }

  await api.uploads.complete(ticket.attachmentId, await imageDimensions(file));
  return ticket.attachmentId;
}

/** Dimensions let a message reserve the right space before the image loads. */
async function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith('image/')) return {};

  const url = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      // A file the browser cannot decode is still a perfectly good attachment.
      image.onerror = () => resolve(null);
      image.src = url;
    });
    return size ?? {};
  } finally {
    URL.revokeObjectURL(url);
  }
}
