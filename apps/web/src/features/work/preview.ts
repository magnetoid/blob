/** The sandbox contract for HTML somebody else wrote, as data. See WorkPreview.tsx and
 *  ADR 0014 — and FilePreviewPanel.tsx, which shows a shared `.html` or `.svg` in the
 *  same box. */

/** What the sandboxed document is allowed to do: draw itself, and nothing else. */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; " +
  "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; " +
  "frame-src 'none'; base-uri 'none'";

/**
 * The page as it will be framed: the policy first, then the page.
 *
 * First in the document rather than spliced into the page's own `<head>`. A `<meta>`
 * before `<html>` opens the head the parser implies and lands in it, so the policy
 * governs everything after it. Finding the page's head with a regex let the page choose
 * where the policy went — a `<!-- <head> -->` ahead of the real one put it inside a
 * comment, where it did nothing. The page's own doctype, if it has one, comes after
 * ours and is ignored; ours keeps the document out of quirks mode.
 */
export function framedDocument(body: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  return `<!doctype html>${meta}${body}`;
}
