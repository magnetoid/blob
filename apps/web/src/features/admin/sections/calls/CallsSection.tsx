/** Calls: huddles and video meetups on one page, a tab each.
 *
 * They were two rows of the console for one media server and one set of rules. Each tab
 * is a URL — /admin/calls/huddles, /admin/calls/meetups — so a link to either still
 * lands on it, and the old /admin/huddles and /admin/meetups resolve here (router.ts).
 *
 * The URL is the state: the tab shown is whichever the route names, and choosing one
 * navigates rather than setting anything here. Arrow keys choose as they move (the
 * panels are one switch and one number each, and the URL is what is being changed), so
 * a keyboard user lands where a click would have.
 */

import type { ConsoleSectionProps } from '../../../console/ConsoleShell.tsx';
import { CALL_TABS, navigate } from '../../../../lib/router.ts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs.tsx';
import { HuddlesSection } from './HuddlesSection.tsx';
import { MeetupsSection } from './MeetupsSection.tsx';

type Tab = (typeof CALL_TABS)[number];

const LABELS: Record<Tab, string> = { huddles: 'Huddles', meetups: 'Video meetups' };

export function CallsSection(props: ConsoleSectionProps) {
  const tab: Tab = props.detailId === 'meetups' ? 'meetups' : 'huddles';
  return (
    <Tabs
      value={tab}
      className="gap-4"
      onValueChange={(next) => navigate(`/admin/calls/${next}`)}
    >
      <TabsList aria-label="Kinds of call" activateOnFocus>
        {CALL_TABS.map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {LABELS[kind]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="huddles">
        <HuddlesSection {...props} />
      </TabsContent>
      <TabsContent value="meetups">
        <MeetupsSection {...props} />
      </TabsContent>
    </Tabs>
  );
}
