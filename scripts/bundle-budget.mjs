// What the first load costs: the JavaScript `index.html` asks for before anything is
// clicked — the entry chunk and what it preloads — gzipped, against a budget. Run after
// `pnpm build`; CI's `check` job does.
//
// A ratchet like `sourceRatchets.test.ts`: lower BUDGET_KB when the app gets lighter, and
// raise it only on purpose, in the commit that says why. It also holds two lines CLAUDE.md
// draws: the call SDK (livekit-client) never reaches the first load — opening a channel
// that merely shows a Meetup button must not cost everybody the media stack — and neither
// does Base UI's overlay code, which would put some 75 KB of dialog, menu and popover machinery
// in front of every first paint (components/overlays/, lib/overlays.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// The measured first load rounded up, plus 1 KB. The entry chunk carries the last commits'
// subjects for "What's new" (vite.config.ts), so the same code weighs a few hundred bytes
// more or less from one commit to the next — 239.6 KB, then 239.7, for one tree — and a
// budget with no room would fail a docs commit, a merge ref or a squash for nothing the
// app does. Lower it with the app, keeping the 1 KB.
const BUDGET_KB = 241;
const DIST = new URL('../apps/web/dist/', import.meta.url);
/** Strings only livekit-client's own code carries. */
const CALL_SDK = /LiveKitError|LiveKitReactNativeGlobal/;
/**
 * Strings only Base UI's overlay code carries in the minified build. Each survives
 * minification because it is a string the browser reads rather than a name the bundler
 * may shorten: `data-base-ui-inert` is the attribute a modal puts on everything outside
 * it, `--available-height` is a CSS variable every Base UI popup's positioner sets for its
 * stylesheet (the same documented family as `--anchor-width` and `--transform-origin`),
 * and `referenceHidden` is the key floating-ui's `hide` middleware answers with. Any one
 * of them in a first-load chunk means a popup, and with it floating-ui, was imported
 * statically instead of through `lib/overlays.ts`. Several, so that one rename upstream
 * cannot blind the guard; and if they all go, the check on every chunk below says so.
 */
const OVERLAY_SDK = /data-base-ui-inert|--available-height|referenceHidden/;

const html = readFileSync(new URL('index.html', DIST), 'utf8');
const initial = [...new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
if (initial.length === 0) {
  console.error('No script in dist/index.html — run `pnpm build` first.');
  process.exit(1);
}

let total = 0;
let failed = false;
for (const file of initial) {
  const source = readFileSync(new URL(file, DIST));
  const kb = gzipSync(source).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(7)} KB  ${file}`);
  const text = source.toString('utf8');
  if (CALL_SDK.test(text)) {
    console.error(`  ${file} carries the call SDK: livekit-client is in the first load.`);
    failed = true;
  }
  if (OVERLAY_SDK.test(text)) {
    console.error(
      `  ${file} carries Base UI's overlay code: a dialog, menu or popover is imported ` +
        'statically. Reach it through lazyOverlay (components/lazyOverlay.tsx) instead.',
    );
    failed = true;
  }
}

// The scan above only means something while OVERLAY_SDK still matches Base UI's overlay
// code. So the marker has to turn up in some chunk of dist/assets (the overlay chunk, as
// built today). If no chunk carries it, upstream renamed the strings or the overlays are
// no longer built, and a pass would be a pass for the wrong reason.
const assets = new URL('assets/', DIST);
const overlayChunk = readdirSync(assets).find(
  (name) => name.endsWith('.js') && OVERLAY_SDK.test(readFileSync(new URL(name, assets), 'utf8')),
);
if (!overlayChunk) {
  console.error('OVERLAY_SDK matches no chunk in dist/assets: the guard has gone blind. Pick a new marker.');
  failed = true;
}
console.log(`${total.toFixed(1).padStart(7)} KB  first load, gzipped (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`The first load grew past its budget by ${(total - BUDGET_KB).toFixed(1)} KB.`);
  failed = true;
}
process.exit(failed ? 1 : 0);
