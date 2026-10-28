/** `api.uploads` — see `lib/api.ts` for the assembled client. */

import { post } from "./client.ts";

export const uploads = {
  create: (input: {
    filename: string;
    mime: string;
    sizeBytes: number;
    kind?: "file" | "voice";
  }) =>
    post<{
      attachmentId: string;
      uploadUrl: string;
      method: "PUT";
      headers: Record<string, string>;
    }>("/api/uploads", input),
  complete: (
    id: string,
    details: {
      width?: number;
      height?: number;
      durationMs?: number;
      waveform?: number[];
    } = {},
  ) => post<{ ok: true }>(`/api/uploads/${id}/complete`, details),
};
