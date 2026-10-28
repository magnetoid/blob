/** The server console: the machine, for whoever administers it.
 *
 * Every account on it, how people sign in, what may be installed, whether its parts
 * answer, what has gone wrong. These pages sat inside /admin with a "Server" badge until
 * the workspace console outgrew one list; they are the same screens, in a console whose
 * one gate — `instance_admins`, a fact about the person and not a role here — is the
 * gate every one of them has.
 *
 * The chat shell is not rendered while this is open, as for the other two consoles.
 */

import type { ComponentType } from 'react';
import { MenuIcon } from '../../components/Icon.tsx';
import { useStore } from '../../lib/store.ts';
import type { ServerSection } from '../../lib/router.ts';
import { Card } from '../console/Card.tsx';
import { ConsoleShell, type ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { SERVER_NAV, serverEntry, viewerOf } from '../console/registry.ts';
import { AccountsSection } from '../admin/sections/AccountsSection.tsx';
import { AppPolicySection } from '../admin/sections/AppPolicySection.tsx';
import { HealthSection } from '../admin/sections/health/HealthSection.tsx';
import { LogsSection } from '../admin/sections/LogsSection.tsx';
import { SsoSection } from '../admin/sections/SsoSection.tsx';

const NAV_ID = 'server-console-nav';

/** Accounts draws its list and leaves the card to whoever shows it, as on People. */
function Accounts(props: ConsoleSectionProps) {
  return (
    <div className="console-stack">
      <Card>
        <AccountsSection {...props} />
      </Card>
    </div>
  );
}

/** Typed as a total record, so a section without a screen fails typecheck. */
const SECTION_COMPONENTS: Record<ServerSection, ComponentType<ConsoleSectionProps>> = {
  health: HealthSection,
  users: Accounts,
  sso: SsoSection,
  'app-policy': AppPolicySection,
  logs: LogsSection,
};

export function ServerConsole({
  section,
  detailId,
  onFeedback,
}: {
  section: ServerSection;
  detailId?: string;
  onFeedback: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const viewer = viewerOf(currentUser);
  const entry = serverEntry(section);
  const Body = SECTION_COMPONENTS[section];

  return (
    <ConsoleShell
      view="server"
      navId={NAV_ID}
      nav={{
        groups: SERVER_NAV,
        basePath: '/server',
        baseAccess: 'instance',
        title: 'This server',
        subtitle: 'You administer the machine every workspace here runs on.',
      }}
      section={section}
      viewer={viewer}
      title={entry.label}
      description={entry.description}
      toggle={{
        className: 'icon-btn admin-nav-toggle',
        label: 'Console sections',
        icon: <MenuIcon size="lg" />,
      }}
      resetKey={`${section}/${detailId ?? ''}`}
      onFeedback={onFeedback}
    >
      {(onError) => (
        <Body
          onError={onError}
          isOwner={viewer.role === 'owner'}
          isInstanceAdmin={viewer.isInstanceAdmin}
          detailId={detailId}
        />
      )}
    </ConsoleShell>
  );
}
