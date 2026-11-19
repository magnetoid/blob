/**
 * What you can do to one of your own sections (M3 · B3): rename it or delete it. A module
 * for `lazyDropdown` — the section's Options button is handed in as `trigger` and is the
 * menu's own — so, as in `ChannelMenu`, the two dialogs are drawn beside the menu and stay
 * when it closes, and when one ends focus goes back to the button. While open it holds its
 * place on the Escape stack (`lib/useMenuEscapeLayer.ts`).
 */

import { useState } from 'react';
import type { SidebarSection } from '@blob/shared';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import type { DropdownModuleProps } from '../../components/lazyDropdown.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { usePath } from '../../lib/router.ts';
import { removeSection } from '../../lib/sidebarSections.ts';
import { useStore } from '../../lib/store.ts';
import { useMenuEscapeLayer } from '../../lib/useMenuEscapeLayer.ts';
import { RenameSectionDialog } from './SectionDialogs.tsx';

interface Props extends DropdownModuleProps {
  section: SidebarSection;
  sections: SidebarSection[];
}

export default function SectionMenu({ trigger, defaultOpen, section, sections }: Props) {
  const setSidebarSections = useStore((s) => s.setSidebarSections);
  const path = usePath();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);

  const [menuPath, setMenuPath] = useState(path);
  if (menuPath !== path) {
    setMenuPath(path);
    setOpen(false);
  }

  /** The item that opened the dialog is gone: focus goes to the button the menu hangs from. */
  function done() {
    setDialog(null);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger ref={triggerRef} render={trigger} />
        <DropdownMenuContent
          ref={popupRef}
          align="start"
          sideOffset={6}
          className="w-auto min-w-44"
        >
          <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={() => setDialog('rename')}>
            Rename section…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            className="pointer-coarse:min-h-11"
            onClick={() => setDialog('delete')}
          >
            Delete section
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogPresence when={dialog === 'rename'}>
        {() => <RenameSectionDialog section={section} onClose={done} />}
      </DialogPresence>
      <DialogPresence when={dialog === 'delete'}>
        {() => (
          <ConfirmDialog
            title={`Delete “${section.name}”?`}
            body="Its conversations go back to where they were. Only the section goes."
            confirmLabel="Delete section"
            danger
            onClose={done}
            onConfirm={() => {
              done();
              void setSidebarSections(removeSection(sections, section.id));
            }}
          />
        )}
      </DialogPresence>
    </>
  );
}
