/** Typed HTTP client. Every call goes through here so error shapes stay consistent. */

import { confirmItsYou } from "../stepUp.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  /**
   * The structured half of a refusal one sentence cannot carry — `lib/errors.AppError`'s
   * `detail`, unwrapped rather than dropped. `field` answers "which input"; this answers
   * "here is the list". Set only by the codes that send one (`janus_refused` carries
   * Janus's `issues`), `undefined` everywhere else, so nothing else changes.
   */
  readonly detail?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    field?: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  confirmed = false,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const error = (
      payload as {
        error?: {
          code: string;
          message: string;
          field?: string;
          detail?: Record<string, unknown>;
        };
      }
    )?.error;
    // A sensitive action refused for want of a recent sign-in: ask the person to
    // confirm it is them, then send the same request once more (`lib/stepUp.ts`). Safe to
    // repeat — the server refused before doing anything.
    if (res.status === 403 && error?.code === "reauth_required" && !confirmed) {
      if (await confirmItsYou()) return request<T>(method, path, body, signal, true);
      throw new ApiError(403, "reauth_cancelled", "Not confirmed, so nothing changed.");
    }
    throw new ApiError(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? "Something went wrong.",
      error?.field,
      error?.detail,
    );
  }

  return payload as T;
}

/**
 * A body that is text and must stay text.
 *
 * `request` parses anything that looks like JSON, which is right for the API and wrong
 * for a file: previewing `data.json` would hand back an object, not what is in the file.
 * Errors are the same `{error: {code, message}}` and become the same `ApiError`.
 */
export async function requestText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(path, { credentials: "same-origin", signal });
  const text = await res.text();
  if (res.ok) return text;
  let error: { code?: string; message?: string } | undefined;
  try {
    error = (JSON.parse(text) as { error?: { code?: string; message?: string } }).error;
  } catch {
    error = undefined;
  }
  throw new ApiError(
    res.status,
    error?.code ?? "unknown",
    error?.message ?? "Something went wrong.",
  );
}

export const get = <T>(path: string, signal?: AbortSignal) =>
  request<T>("GET", path, undefined, signal);
export const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body);
export const patch = <T>(path: string, body?: unknown) =>
  request<T>("PATCH", path, body);
export const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const del = <T>(path: string, body?: unknown) =>
  request<T>("DELETE", path, body);
