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
   * Owner-only, and separate from `adminOnly` for a reason that bites: being an admin
   * does not open every server page. The console nav gates its own rows by the server's
   * gate on each (`access` in `features/console/registry.ts` — accounts, health and logs
   * are the server admin's, not the owner's); this flag is for whole pages that should
   * not appear in the account menu either.
   */
  ownerOnly?: boolean;
  /** The machine's console: for whoever administers the server, whatever their role here. */
  instanceOnly?: boolean;
}

// Three pages, one owner each. Preferences are yours. The workspace — name, people,
// channels, agents, data — is its admins'. The machine — accounts, sign-on, health — is
// the server administrator's, and is offered to nobody else.
export const ITEMS: Item[] = [
  { label: 'Workspace settings', path: '/admin', adminOnly: true },
  { label: 'Server', path: '/server', instanceOnly: true },
  { label: 'User profile', path: '/settings/preferences' },
  { label: 'Preferences', path: '/settings' },
  { label: 'Help', path: '/help' },
  { label: "What's new", path: '/whats-new' },
  { label: 'Feedback', action: 'feedback' },
];
