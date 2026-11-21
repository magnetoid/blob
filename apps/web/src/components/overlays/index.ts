/**
 * The overlay chunk: everything that is built on Base UI's overlay machinery.
 *
 * Nothing imports this file but `lib/overlays.ts`, and that does it with a dynamic
 * `import()` — so the bundler gives it, and the modules below, a chunk of their own that
 * the first page load never asks for (`scripts/bundle-budget.mjs` checks it). A component
 * that needs an overlay does not import from here; it asks `lazyOverlay` for the export it
 * wants (`lazyOverlay((m) => m.DialogImpl)`).
 *
 * One export per overlay: `DialogImpl`, `ConfirmDialogImpl` and `SidebarSheetImpl`. Each
 * is mounted by its first-load half while it is open and through its exit, so a chunk that
 * failed to load is asked for again on the next opening.
 * The sidebar's sheet stays mounted once it has opened and the chunk is here, so that every
 * close plays its exit (`components/ui/sidebar.tsx`).
 */
export { DialogImpl } from './DialogImpl.tsx';
export { ConfirmDialogImpl } from './ConfirmDialogImpl.tsx';
export { SidebarSheetImpl } from './SidebarSheetImpl.tsx';
