/** Yours: how Blob looks, when it interrupts you, the agents on your machine.
 *
 * A page of its own, because these are not the server's business. Server settings live
 * under /admin. The two used to share a console named after "the workspace", which made
 * a private preference look like an admin screen and an admin screen look like Slack Grid.
 */

import type { ComponentType } from 'react';
import { MenuIcon } from '../../components/Icon.tsx';
import { useStore } from '../../lib/store.ts';
import type { SettingsSection } from '../../lib/router.ts';
import { ConsoleShell } from '../console/ConsoleShell.tsx';
import { SETTINGS_NAV, settingsEntry } from '../console/registry.ts';
import type { ConsoleSectionProps } from '../console/ConsoleShell.tsx';
import { PreferencesSection } from './PreferencesSection.tsx';
import { NotificationsSection } from './NotificationsSection.tsx';
import { MyAgentsSection } from './MyAgentsSection.tsx';
import { AssistantsSection } from './AssistantsSection.tsx';

const NAV_ID = 'settings-console-nav';

const SECTION_COMPONENTS: Record<SettingsSection, ComponentType<ConsoleSectionProps>> = {
  preferences: PreferencesSection,
  notifications: NotificationsSection,
  'my-agents': MyAgentsSection,
  assistants: AssistantsSection,
};

export function SettingsConsole({
  section,
  onFeedback,
  onSignedOut,
}: {
  section: SettingsSection;
  onFeedback: () => void;
  onSignedOut: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const isOwner = currentUser?.role === 'owner';
  const entry = settingsEntry(section);
  const Body = SECTION_COMPONENTS[section];

  return (
    <ConsoleShell
      view="settings"
      navId={NAV_ID}
      nav={{
        groups: SETTINGS_NAV,
        basePath: '/settings',
        title: 'You',
        subtitle: 'How Blob behaves for you.',
      }}
      section={section}
      isOwner={isOwner}
      title={entry.label}
      description={entry.description}
      toggle={{
        className: 'icon-btn admin-nav-toggle',
        label: 'Open the section menu',
        icon: <MenuIcon size="lg" />,
      }}
      onFeedback={onFeedback}
    >
      {(onError) => (
        <Body onError={onError} isOwner={isOwner} onSignedOut={onSignedOut} />
      )}
    </ConsoleShell>
  );
}
