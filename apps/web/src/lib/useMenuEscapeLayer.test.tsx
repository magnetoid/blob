// @vitest-environment happy-dom
/**
 * Which Escapes a menu's place on the stack leaves to the menu (`lib/useMenuEscapeLayer.ts`).
 *
 * A key from inside the menu is Base UI's, and the layer lets it through; any other, the
 * layer answers by closing the menu. A submenu is the menu's own even though Base UI
 * portals it beside the menu's popup rather than inside it: let through, its Escape closes
 * only the submenu, as the menu pattern says it should. Without that the first submenu in
 * the app, a message's Remind me…, closed the whole menu on one Escape. A popup that no
 * item of this menu opened — another menu's — is still outside.
 *
 * The popups here are plain markup with the relation Base UI draws between a submenu's
 * item and its popup: `aria-haspopup="menu"` and `aria-controls` naming the popup's id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dispatch, SetStateAction } from 'react';
import { useMenuEscapeLayer } from './useMenuEscapeLayer.ts';

afterEach(cleanup);

function Menus({ setOpen }: { setOpen: Dispatch<SetStateAction<boolean>> }) {
  const { popupRef, triggerRef } = useMenuEscapeLayer(true, setOpen);
  return (
    <>
      <button ref={triggerRef} type="button">
        Options
      </button>
      <div ref={popupRef} role="menu" aria-label="Options">
        <div role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-controls="remind">
          Remind me…
        </div>
      </div>
      {/* Beside the popup, where Base UI's portal puts a submenu; and one inside that. */}
      <div id="remind" role="menu" aria-label="Remind me">
        <div role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-controls="later">
          Later
        </div>
      </div>
      <div id="later" role="menu" aria-label="Later">
        <div role="menuitem" tabIndex={-1}>
          Next week
        </div>
      </div>
      <div role="menu" aria-label="Another menu">
        <div role="menuitem" tabIndex={-1}>
          Somebody else’s item
        </div>
      </div>
    </>
  );
}

function escapeFrom(name: string) {
  const item = screen.getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Escape' });
}

describe('a menu’s place on the Escape stack', () => {
  it('leaves a key from its popup or its trigger to the menu', () => {
    const setOpen = vi.fn();
    render(<Menus setOpen={setOpen} />);

    escapeFrom('Remind me…');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Options' }), { key: 'Escape' });

    expect(setOpen).not.toHaveBeenCalled();
  });

  it('leaves a key from one of its submenus to the menu, however deep', () => {
    const setOpen = vi.fn();
    render(<Menus setOpen={setOpen} />);

    escapeFrom('Later');
    escapeFrom('Next week');

    expect(setOpen).not.toHaveBeenCalled();
  });

  it('closes the menu for a key from another menu’s popup, or from the page', () => {
    const setOpen = vi.fn();
    render(<Menus setOpen={setOpen} />);

    escapeFrom('Somebody else’s item');
    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenLastCalledWith(false);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(setOpen).toHaveBeenCalledTimes(2);
  });
});
