/** What the account menu contains, as data.
 *
 * Separate from TopBar.tsx so it can be read by a test — and because a file that exports
 * both a component and a constant loses fast refresh, which the lint rule is right about.
 * Same shape as the admin console's registry: the list is the source, the component only
 * renders it.
 */

export interface Item {
  label: string;
  path?: string;
  action?: 'feedback';
  /** Shown but inert, with a reason, rather than hidden. */
  soon?: boolean;
  adminOnly?: boolean;
}

// Three different things were all reachable as "settings", which is one word doing too
// much work: how this account behaves, how the workspace behaves, and how the server
// behaves. They are separate pages, so they are separate rows — and "Preferences" is
// what Slack calls the personal one, which is the name people arrive already knowing.
export const ITEMS: Item[] = [
  { label: 'Workspace settings', path: '/workspace', adminOnly: true },
  { label: 'Superadmin', path: '/admin', adminOnly: true },
  { label: 'User profile', path: '/profile' },
  { label: 'Preferences', path: '/settings' },
  { label: 'Update', soon: true },
  { label: 'Feedback', action: 'feedback' },
];
