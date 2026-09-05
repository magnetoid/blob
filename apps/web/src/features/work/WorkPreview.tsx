/** An agent's HTML, shown — in a box it cannot see out of, and only when asked.
 *
 * This is the one place Blob runs something an agent wrote, so the contract is explicit
 * (ADR 0014):
 *
 * - The frame is `sandbox="allow-scripts"` and nothing else. No `allow-same-origin`, so the
 *   document runs in an opaque origin: no cookies, no localStorage, no reading the page
 *   around it, no `fetch` to the workspace with the person's session.
 * - A policy is written into the document's own head — `default-src 'none'` with inline
 *   styles and scripts allowed and no network of any kind — so a page cannot phone home,
 *   load a tracker, or submit a form anywhere. The outer page's CSP (`frame-src 'self'`)
 *   is what lets a `srcdoc` frame exist at all.
 * - It renders on a click, never on arrival. A preview that runs the moment it lands is a
 *   preview that runs the moment somebody scrolls past it.
 *
 * A markdown artifact goes through the same renderer messages use, which is the whole
 * escaping story for text in this app.
 */

import { useState } from "react";
import type { WorkArtifact } from "@blob/shared";
import { renderMarkdown } from "../../lib/markdown.tsx";
import { useStore } from "../../lib/store.ts";
import { framedDocument } from "./preview.ts";

export function WorkPreview({ artifact }: { artifact: WorkArtifact }) {
  const [running, setRunning] = useState(false);
  const currentUserId = useStore((s) => s.currentUser?.id ?? null);
  const customEmoji = useStore((s) => s.customEmoji);

  if (artifact.kind === "markdown") {
    // The message renderer, with no mention index: a document is not addressed to anyone,
    // and highlighting `@name` in one would make it look like a notification it is not.
    return (
      <div className="work-document markdown">
        {renderMarkdown(artifact.body, {
          knownNames: new Map(),
          currentUserId,
          customEmoji,
        })}
      </div>
    );
  }

  if (!running) {
    return (
      <div className="work-preview-gate">
        <p className="pref-hint">
          A page {artifact.authorUserId ? "an agent" : "somebody"} published. It
          runs in a sandbox — no network, no cookies, no access to this
          workspace — and only when you ask.
        </p>
        <button className="btn btn-primary" onClick={() => setRunning(true)}>
          Run preview
        </button>
      </div>
    );
  }

  return (
    <iframe
      className="work-preview-frame"
      title={artifact.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={framedDocument(artifact.body)}
    />
  );
}
