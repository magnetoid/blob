/** Calls: huddles and video meetups on one page, a tab each.
 *
 * They were two rows of the console for one media server and one set of rules. Each tab
 * is a URL — /admin/calls/huddles, /admin/calls/meetups — so a link to either still
 * lands on it, and the old /admin/huddles and /admin/meetups resolve here (router.ts).
 */

import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { CALL_TABS, navigate } from '../../../../lib/router.ts';
import { HuddlesSection } from './HuddlesSection.tsx';
import { MeetupsSection } from './MeetupsSection.tsx';

type Tab = (typeof CALL_TABS)[number];

const LABELS: Record<Tab, string> = { huddles: 'Huddles', meetups: 'Video meetups' };

export function CallsSection(props: ConsoleSectionProps) {
  const tab: Tab = props.detailId === 'meetups' ? 'meetups' : 'huddles';
  const Body = tab === 'meetups' ? MeetupsSection : HuddlesSection;
  return (
    <>
      <div className="console-tabs" role="tablist" aria-label="Kinds of call">
        {CALL_TABS.map((kind) => (
          <button
            key={kind}
            role="tab"
            aria-selected={tab === kind}
            className="chip"
            data-active={tab === kind}
            onClick={() => navigate(`/admin/calls/${kind}`)}
          >
            {LABELS[kind]}
          </button>
        ))}
      </div>
      <Body {...props} />
    </>
  );
}
