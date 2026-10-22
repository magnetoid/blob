// Slack's emoji names → characters, for importing a Slack export (ADR 0042).
//
// A Slack export names a reaction (`thumbsup`, `+1::skin-tone-3`) and writes `:tada:` in
// message text; Blob stores the character. Slack's names come from iamcal's emoji-data,
// published on npm as `emoji-datasource` (MIT, © Cal Henderson), so the table is built from
// that and checked in — the API has no npm at run time.
//
// To refresh it (pin the version you read):
//
//   npm pack emoji-datasource@16.0.0 && tar xzf emoji-datasource-16.0.0.tgz
//   node scripts/slack-emoji.mjs package/emoji.json 16.0.0
//
// It writes apps/api/src/blob_api/lib/slack_emoji.json: every short name, and for an
// emoji with skin tones its five toned forms, light to dark (Slack's skin-tone-2 … -6).
import { readFileSync, writeFileSync } from 'node:fs';

const [source, version] = process.argv.slice(2);
if (!source || !version) {
  console.error('usage: node scripts/slack-emoji.mjs <emoji.json> <version>');
  process.exit(1);
}

const char = (unified) =>
  String.fromCodePoint(...unified.split('-').map((hex) => Number.parseInt(hex, 16)));
const TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'];

const names = {};
const tones = {};
for (const emoji of JSON.parse(readFileSync(source, 'utf8'))) {
  const plain = char(emoji.unified);
  for (const name of emoji.short_names) names[name] = plain;
  const variations = emoji.skin_variations ?? {};
  if (TONES.every((tone) => variations[tone])) {
    // Under every name, since an export may use any of them: `+1` and `thumbsup`.
    const toned = TONES.map((tone) => char(variations[tone].unified));
    for (const name of emoji.short_names) tones[name] = toned;
  }
}

const sorted = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(
  new URL('../apps/api/src/blob_api/lib/slack_emoji.json', import.meta.url),
  `${JSON.stringify({
    source: `emoji-datasource ${version}`,
    names: sorted(names),
    tones: sorted(tones),
  })}\n`,
);
console.log(`${Object.keys(names).length} names, ${Object.keys(tones).length} with tones`);
