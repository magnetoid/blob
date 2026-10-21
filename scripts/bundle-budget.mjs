// What the first load costs: the JavaScript `index.html` asks for before anything is
// clicked — the entry chunk and what it preloads — gzipped, against a budget. Run after
// `pnpm build`; CI's `check` job does.
//
// A ratchet like `sourceRatchets.test.ts`: lower BUDGET_KB when the app gets lighter, and
// raise it only on purpose, in the commit that says why. It also holds one line CLAUDE.md
// draws: the call SDK (livekit-client) never reaches the first load — opening a channel
// that merely shows a Meetup button must not cost everybody the media stack.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 220;
const DIST = new URL('../apps/web/dist/', import.meta.url);
/** Strings only livekit-client's own code carries. */
const CALL_SDK = /LiveKitError|LiveKitReactNativeGlobal/;

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
  if (CALL_SDK.test(source.toString('utf8'))) {
    console.error(`  ${file} carries the call SDK: livekit-client is in the first load.`);
    failed = true;
  }
}
console.log(`${total.toFixed(1).padStart(7)} KB  first load, gzipped (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB) {
  console.error(`The first load grew past its budget by ${(total - BUDGET_KB).toFixed(1)} KB.`);
  failed = true;
}
process.exit(failed ? 1 : 0);
