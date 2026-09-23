/** The server console: this machine, its people, its channels, its health.
 *
 * One page rather than two. General, members, channels and apps used to live under
 * /workspace, while accounts, audit and health lived under /admin — which made one
 * open-source server look like a grid of workspaces. They are the same job now.
 *
 * Your own preferences are a different page (/settings). They are private.
 *
 * The chat shell is not rendered at all while this is open — see Workspace.tsx. ⌘K still
 * works, because switching to a conversation is exactly what you want after finishing
 * with an admin page.
 */

import type { ComponentType } from 'react';
import { MenuIcon } from '../../components/Icon.tsx';
import { useStore } from '../../lib/store.ts';
import type { AdminSection } from '../../lib/router.ts';
import { Card } from '../console/Card.tsx';
import { ConsoleShell, type ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { ADMIN_NAV, sectionEntry } from '../console/registry.ts';
import { AppPolicySection } from './sections/AppPolicySection.tsx';
import { AccountsSection } from './sections/AccountsSection.tsx';
import { AuditSection } from './sections/AuditSection.tsx';
import { FeedbackSection } from './sections/FeedbackSection.tsx';
import { HealthSection } from './sections/health/HealthSection.tsx';
import { LogsSection } from './sections/LogsSection.tsx';
import { AppsSection } from './sections/AppsSection.tsx';
import { ChannelsSection } from './sections/ChannelsSection.tsx';
import { DeliveriesSection } from './sections/DeliveriesSection.tsx';
import { EmojiSection } from './sections/EmojiSection.tsx';
import { GeneralSection } from './sections/GeneralSection.tsx';
import { GroupsSection } from './sections/GroupsSection.tsx';
import { InvitationsSection } from './sections/InvitationsSection.tsx';
import { JanusSection } from './sections/janus/JanusSection.tsx';
import { MeetupsSection } from './sections/calls/MeetupsSection.tsx';
import { PeopleHub } from './sections/PeopleHub.tsx';
import { ThemesSection } from './sections/ThemesSection.tsx';
import { WebhooksSection } from './sections/WebhooksSection.tsx';

const NAV_ID = 'admin-console-nav';

/**
 * A part of the People page reached by its old URL, in the card the People page gives
 * it. The parts draw their contents and leave the card to whoever shows them, so that
 * the hub can title each one.
 *
 * Groups alone has a page under it — one group's members, `/admin/groups/:id` — and
 * draws that page's cards itself, so only there does a detail id mean "not framed".
 * `/admin/users/:id` is a real route too, but Accounts has no detail page: it shows the
 * list, and the list needs its card like anywhere else.
 */
function framed(
  Part: ComponentType<ConsoleSectionProps>,
  { drawsItsDetailPage = false }: { drawsItsDetailPage?: boolean } = {},
): ComponentType<ConsoleSectionProps> {
  return function Framed(props: ConsoleSectionProps) {
    if (drawsItsDetailPage && props.detailId) return <Part {...props} />;
    return (
      <div className="console-stack">
        <Card>
          <Part {...props} />
        </Card>
      </div>
    );
  };
}

/**
 * Every route needs a screen. Typed as a total record, so adding a section to
 * ADMIN_SECTIONS without building it is a typecheck failure rather than a blank page.
 */
const SECTION_COMPONENTS: Record<AdminSection, ComponentType<ConsoleSectionProps>> = {
  general: GeneralSection,
  appearance: ThemesSection,
  members: PeopleHub,
  groups: framed(GroupsSection, { drawsItsDetailPage: true }),
  invitations: framed(InvitationsSection),
  channels: ChannelsSection,
  emoji: EmojiSection,
  meetups: MeetupsSection,
  apps: AppsSection,
  janus: JanusSection,
  webhooks: WebhooksSection,
  deliveries: DeliveriesSection,
  users: framed(AccountsSection),
  'app-policy': AppPolicySection,
  feedback: FeedbackSection,
  audit: AuditSection,
  logs: LogsSection,
  health: HealthSection,
};

export function AdminConsole({
  section,
  detailId,
  onFeedback,
}: {
  section: AdminSection;
  detailId?: string;
  onFeedback: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const isOwner = currentUser?.role === 'owner';

  const entry = sectionEntry(section);
  const Body = SECTION_COMPONENTS[section];

  return (
    <ConsoleShell
      view="admin"
      navId={NAV_ID}
      nav={{
        groups: ADMIN_NAV,
        basePath: '/admin',
        title: 'This server',
        subtitle: isOwner ? 'You own this server.' : 'You are an admin of this server.',
      }}
      section={section}
      isOwner={isOwner}
      title={entry.label}
      description={entry.description}
      toggle={{
        className: 'icon-btn admin-nav-toggle',
        label: 'Console sections',
        icon: <MenuIcon size="lg" />,
      }}
      // An error belongs to the page — section and detail — that produced it.
      resetKey={`${section}/${detailId ?? ''}`}
      onFeedback={onFeedback}
    >
      {(onError) => <Body onError={onError} isOwner={isOwner} detailId={detailId} />}
    </ConsoleShell>
  );
}
