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
   * Owner-only, and separate from `adminOnly` for a reason that bites: the instance
   * console reads past this workspace, so every one of its endpoints is owner-gated.
   * Showing an admin the link would hand them a console where each page answers 403.
   */
  ownerOnly?: boolean;
}

// Three different things were all reachable as "settings", which is one word doing too
// much work: how this account behaves, how the workspace behaves, and how the server
// behaves. They are separate pages, so they are separate rows — and "Preferences" is
// what Slack calls the personal one, which is the name people arrive already knowing.
export const ITEMS: Item[] = [
  { label: 'Manage workspace', path: '/workspace', adminOnly: true },
  { label: 'Manage server', path: '/admin', adminOnly: true, ownerOnly: true },
  { label: 'User profile', path: '/profile' },
  { label: 'Preferences', path: '/workspace/preferences' },
  // Everything the app does, on one page. Slack's equivalent leaves the product for a
  // help centre on another domain, which is a worse answer for something self-hosted:
  // the guide has to describe *this* workspace, on *this* build, and a page that ships
  // in the bundle is the only version that always matches what is on screen.
  { label: 'Help', path: '/help' },
  // Was a disabled row marked "Soon" from the day this menu was written.
  { label: "What's new", path: '/whats-new' },
  { label: 'Feedback', action: 'feedback' },
];
