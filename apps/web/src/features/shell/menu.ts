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
  /**
   * Owner-only, and separate from `adminOnly` for a reason that bites: some server
   * pages (accounts, health, logs) 403 for an admin who is not the owner. Those rows
   * are hidden in the console nav; this flag is for whole pages that should not appear
   * in the account menu either.
   */
  ownerOnly?: boolean;
}

// Two pages, not three. Preferences are yours. Server settings are the rest —
// name, people, channels, health — on one admin page. Blob is one server.
export const ITEMS: Item[] = [
  { label: 'Server settings', path: '/admin', adminOnly: true },
  { label: 'User profile', path: '/profile' },
  { label: 'Preferences', path: '/settings' },
  { label: 'Help', path: '/help' },
  { label: "What's new", path: '/whats-new' },
  { label: 'Feedback', action: 'feedback' },
];
