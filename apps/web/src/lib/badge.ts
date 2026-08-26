/**
 * Unread counts where a backgrounded tab can show them: the title, and the OS app
 * badge where the app is installed. The title is the one that matters — for a
 * browser-first product, "(3) Blob" in the tab strip is the notification surface
 * that needs no permission prompt.
 */

const BASE_TITLE = 'Blob';

export function updateBadge(mentions: number, hasUnread: boolean): void {
  if (typeof document !== 'undefined') {
    document.title =
      mentions > 0 ? `(${mentions}) ${BASE_TITLE}` : hasUnread ? `• ${BASE_TITLE}` : BASE_TITLE;
  }
  // Installed-app badge (Android, desktop PWA, iOS 16.4+ when installed). Mentions
  // only: a dot-level unread on the home screen icon would nag forever.
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && 'setAppBadge' in nav) {
    try {
      if (mentions > 0) void (nav as Navigator & { setAppBadge(n: number): Promise<void> }).setAppBadge(mentions);
      else void (nav as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge();
    } catch {
      // Badging is a convenience; never let it surface an error.
    }
  }
}
