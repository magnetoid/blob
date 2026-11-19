/**
 * The sidebar below 768px: shadcn's Sheet, which is Base UI's dialog sliding in from the
 * side, holding whatever the sidebar holds.
 *
 * It is the mobile branch of `components/ui/sidebar.tsx`, moved here unchanged so that the
 * sidebar can be drawn at first paint without Base UI's dialog in the first load: the chat
 * shell's channel list is a sidebar, and a statically imported Sheet would put the overlay
 * code in front of every page. `Sidebar` draws this through `lazyOverlay`, mounted the
 * first time the sheet opens and kept after, so Base UI can play its exit.
 */

import type { CSSProperties, ReactNode, RefObject } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '../ui/button.tsx';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet.tsx';

export interface SidebarSheetImplProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'left' | 'right';
  dir?: string | undefined;
  /** The sheet's width, as `--sidebar-width`. */
  width: string;
  /** What the sheet is called, where it is a dialog. */
  label: string;
  /** What the sheet's close button is called, for a screen reader that has no Escape. */
  closeLabel: string;
  /** The trigger that last opened the sheet, which is where focus goes when it closes. */
  openerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function SidebarSheetImpl({
  open,
  onOpenChange,
  side,
  dir,
  width,
  label,
  closeLabel,
  openerRef,
  children,
}: SidebarSheetImplProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground"
        // The generated close is named only "Close"; the one below says which menu.
        showCloseButton={false}
        style={
          {
            '--sidebar-width': width,
          } as CSSProperties
        }
        side={side}
        // Back to the trigger that opened it. The dialog's own default is whatever had
        // focus before it opened, and Safari does not focus a button that is clicked,
        // so there it was the page. Opened some other way, the default stands — so the
        // opener is spent here, on the close it was recorded for.
        finalFocus={() => {
          const opener = openerRef.current;
          openerRef.current = null;
          return opener ?? true;
        }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
        {/* The backdrop is no way out for a screen reader on a phone, where the page
            behind the modal is inert and there is no Escape. After the children, so
            the dialog still opens on the nav and not on this. */}
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3"
              aria-label={closeLabel}
            />
          }
        >
          <XIcon />
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
