/** The chrome the three consoles share.
 *
 * The settings, workspace and server consoles are rooms of one product, with the same
 * frame deliberately, and this component is that sameness made structural: the top bar,
 * the nav, the page heading, the error slot, the page's one entrance.
 *
 * The frame is shadcn's Sidebar. From 768px the nav is a column on the ground and the
 * page is the paper card beside it — the same card the chat's views sit in, inset by
 * `--frame-gap`, rounded `--frame-radius` and lifted by `--elev-frame`, so moving between
 * a console and a channel is moving between pages of one app. Below 768px the nav is a
 * sheet over the page, opened from the page's header and closed by choosing a section,
 * by Escape or by the backdrop, with focus handed back to the button that opened it.
 *
 * The body is converted markup, under its own `data-slot="console-body"`, so Tailwind's
 * preflight holds there as it does inside any shadcn component (`styles/app/base.css`).
 * While the sections were being converted it was a `data-legacy` island instead, and an
 * island inside a card inside that one went unreached. Closed, it lets the islands the
 * sections still keep be reached: what an agent remembers, its notes and its terminal
 * (`features/agentic/`) and the chat's own run card (`features/messages/AgentRunCard.tsx`)
 * are islands inside cards, and the setup panels — Janus's, the bridge's — are islands
 * between them. The top bar stays an island: it is another feature's and sits inside the
 * sidebar's provider. `.admin-main` is what the end-to-end tests and the axe pass wait
 * for. `.admin-page` is the size container (`console-page`) sections ask for the column's
 * width, and the element the agentic rows' stylesheet declares `--console-row-hover` on.
 *
 * What differs between the consoles arrives as props. What a console gates for its body
 * — roles, sign-out — stays in the console.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '../../components/ui/sidebar.tsx';
import { TopBar } from '../shell/TopBar.tsx';
import { ConsoleNav } from './ConsoleNav.tsx';
import type { Access, NavGroup, Viewer } from './registry.ts';

export interface ConsoleSectionProps {
  onError: (message: string | null) => void;
  isOwner: boolean;
  /**
   * Whether this person administers the server, not only this workspace. People reads it
   * to draw Accounts, the part of that page the server keeps for its admin — the same
   * gate as the `users` row in the registry. Optional: no other section asks yet.
   */
  isInstanceAdmin?: boolean;
  detailId?: string;
  /**
   * Only the Preferences section uses this — it owns the Sign out button, which is the
   * one control on these pages that ends the session rather than changing a setting.
   */
  onSignedOut?: () => void;
}

/** What the nav shows: the consoles differ in catalogue and framing, not in the mount. */
export interface ConsoleNav {
  groups: NavGroup[];
  /** `/admin`, `/server` or `/settings` — the prefix the nav's rows navigate under. */
  basePath: string;
  /**
   * The level everybody who can open this console passes. A row at that level carries
   * no badge; one the console keeps from some of its visitors names who may open it.
   */
  baseAccess?: Access;
  title: string;
  subtitle: string;
}

/** The nav is the chat's channel list in width, so the two frames line up. */
const NAV_WIDTH = { '--sidebar-width': 'var(--blob-sidebar-width)' } as CSSProperties;

export function ConsoleShell({
  view,
  navId,
  nav,
  section,
  viewer,
  title,
  description,
  resetKey,
  onFeedback,
  children,
}: {
  /** Which console this is, for the top bar's pressed state. */
  view: 'admin' | 'settings' | 'server';
  /** Ties the section menu's button to the nav it opens, for anything reading the page. */
  navId: string;
  nav: ConsoleNav;
  section: string;
  /** Who is looking. The nav offers each row by it; the body is gated by the console. */
  viewer: Viewer;
  title: string;
  description?: string;
  /**
   * Scopes an error to the page that produced it: when this changes, the error clears.
   * Omitted, errors survive navigation between sections.
   */
  resetKey?: string;
  onFeedback: () => void;
  /** The body needs somewhere to put its errors, so children take the setter. */
  children: (onError: (message: string | null) => void) => ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);

  // Clearing during render rather than in an effect avoids showing the previous page's
  // failure for one frame — including when the Back button is what moved you.
  const [shownFor, setShownFor] = useState(resetKey);
  if (shownFor !== resetKey) {
    setShownFor(resetKey);
    setError(null);
  }

  return (
    <SidebarProvider
      className="h-full min-h-0 flex-col overflow-hidden bg-sidebar"
      style={NAV_WIDTH}
    >
      {/* Same top row as the chat shell, because the account menu lives in it and a menu
          that exists in only some views is a menu people lose. */}
      <div data-legacy className="grid h-(--topbar-height) shrink-0">
        <TopBar onFeedback={onFeedback} view={view} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Under the bar rather than the full height the generated sidebar takes. */}
        <Sidebar
          variant="inset"
          collapsible="offcanvas"
          label="Section menu"
          className="top-(--topbar-height) h-auto"
        >
          <ConsoleNav
            id={navId}
            groups={nav.groups}
            section={section}
            viewer={viewer}
            basePath={nav.basePath}
            baseAccess={nav.baseAccess}
            title={nav.title}
            subtitle={nav.subtitle}
          />
        </Sidebar>

        {/* The page is its own scroller, so its corners clip what scrolls inside them;
            the gutter is stable so the centred column does not step sideways by a
            scrollbar's width when a section grows long enough to scroll. */}
        <SidebarInset className="admin-main min-h-0 min-w-0 overflow-y-auto [scrollbar-gutter:stable] md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:mr-(--frame-gap) md:peer-data-[variant=inset]:mb-(--frame-gap) md:peer-data-[variant=inset]:rounded-(--frame-radius) md:peer-data-[variant=inset]:shadow-(--elev-frame)">
          {/* The gutter steps down with the window: 40px at a desk, 16px on a phone. */}
          <div className="px-4 pt-5 pb-10 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10">
            {/* One column for every section, centred in whatever the nav leaves, and a
                size container so a section can ask how wide it is. */}
            <div className="admin-page @container/console-page mx-auto w-full max-w-(--console-width)">
              {/* A div, not a <header>: inside <main> one is no landmark in a browser, and
                  tools that still read it as a second banner are the ones it would mislead. */}
              <div className="flex items-start gap-3 border-b pb-5 sm:pb-6">
                <SectionMenuTrigger navId={navId} />
                <div className="min-w-0">
                  <h1 className="font-heading text-(length:--blob-text-xl) leading-tight font-semibold tracking-tight">
                    {title}
                  </h1>
                  {description && (
                    <p className="mt-2 max-w-[68ch] text-sm text-pretty text-muted-foreground">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              {/* A failure is a notice about the page, not a stray red sentence between its
                  header and its first card — and an alert, so it is heard when it arrives. */}
              {error && (
                <p
                  role="alert"
                  className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              {/* Keyed by the section, so arriving at a page plays its entrance once — and a
                  detail id changing inside one (Apps → one app) does not replay it.
                  `backwards`, so nothing is left holding a transform after it lands; reduced
                  motion takes --motion-slide to zero and keeps the fade. */}
              <div
                data-slot="console-body"
                key={section}
                className="mt-6 animate-in duration-(--dur-open) ease-(--blob-ease-out) fade-in fill-mode-backwards slide-in-from-bottom-(length:--motion-slide) sm:mt-8"
              >
                {children(setError)}
              </div>
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

/**
 * The page header's way to the nav where the nav is a sheet. Hidden from 768px, where the
 * nav is always on screen beside the page.
 */
function SectionMenuTrigger({ navId }: { navId: string }) {
  const { openMobile } = useSidebar();
  return (
    <SidebarTrigger
      className="-ml-1.5 shrink-0 md:hidden"
      aria-label="Open the section menu"
      aria-expanded={openMobile}
      // The nav is on the page only while the sheet is open.
      aria-controls={openMobile ? navId : undefined}
    />
  );
}
