/** The sandbox contract for an agent's HTML preview, as data. See WorkPreview.tsx and ADR 0014. */

/** What the sandboxed document is allowed to do: draw itself, and nothing else. */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; " +
  "script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; " +
  "frame-src 'none'; base-uri 'none'";

/** The page as it will be framed: the agent's HTML with the policy put first. */
export function framedDocument(body: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const head = /<head[^>]*>/i.exec(body);
  if (head)
    return (
      body.slice(0, head.index + head[0].length) +
      meta +
      body.slice(head.index + head[0].length)
    );
  if (/<html[^>]*>/i.test(body))
    return body.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${body}</body></html>`;
}
