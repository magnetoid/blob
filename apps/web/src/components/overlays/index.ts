/**
 * The overlay chunk: everything that is built on Base UI's overlay machinery.
 *
 * Nothing imports this file but `lib/overlays.ts`, and that does it with a dynamic
 * `import()` — so the bundler gives it, and the modules below, a chunk of their own that
 * the first page load never asks for (`scripts/bundle-budget.mjs` checks it). A component
 * that needs an overlay does not import from here; it asks `lazyOverlay` for the export it
 * wants (`lazyOverlay((m) => m.DialogImpl)`).
 *
 * The implementations join this list as they are written — `DialogImpl`,
 * `ConfirmDialogImpl`, `MenuImpl`, `PopoverImpl`. Until they do, the generated shadcn
 * modules are exported as namespaces so the chunk holds what it will hold: the build guard
 * is only worth having if it has overlay code to look for. Each of these exports goes when
 * the implementation that uses the same module arrives.
 */
export * as dialogUi from '../ui/dialog.tsx';
export * as alertDialogUi from '../ui/alert-dialog.tsx';
export * as dropdownMenuUi from '../ui/dropdown-menu.tsx';
export * as popoverUi from '../ui/popover.tsx';
