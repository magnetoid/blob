/** Admin → Export (M3 · B4): the workspace's public conversations and its people, as a zip
 *  of JSON lines. Never a private channel or a DM — those leave only through their own
 *  people's personal exports. */

import { ExportsCard } from '../../console/ExportsCard.tsx';

export function ExportSection() {
  return (
    <div className="console-stack">
      <ExportsCard
        scope="workspace"
        title="Export the workspace"
        description="Every public channel — archived ones too — with its messages, reactions and the list of its files, and the people in the workspace with their email addresses. Private channels and direct messages are never included: each person can export their own from their settings."
      />
    </div>
  );
}
