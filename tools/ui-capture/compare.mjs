#!/usr/bin/env node
/*
 * Diff two captures and report whether the rendered text moved.
 *
 *   npm run ui:compare -- <before-dir> <after-dir>
 *
 * ---------------------------------------------------------------------------
 * What is normalised, and why only these two
 * ---------------------------------------------------------------------------
 *
 * The grid is `force-dynamic`. Two runs minutes apart legitimately differ in
 * exactly two places, and neither is content:
 *
 *   `Evaluated <when>`   the instant the render happened
 *   `<N> min old`        how old the newest buoy observation was at that instant
 *
 * Nothing else is touched. Normalising anything further would be building a
 * diff that cannot fail, which is worse than no check at all -- in #122 and
 * #123 EVERY difference across all thirty captures was `55 min old` becoming
 * `56 min old`, and the value of the result came from that being the only thing
 * the filter removed.
 *
 * Exits non-zero on any difference, or if the two runs disagree on their
 * capture date -- two runs either side of local midnight request different day
 * pages and are not comparable, and that would otherwise read as a content
 * change.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [before, after] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!before || !after) {
  console.error('usage: node tools/ui-capture/compare.mjs <before-dir> <after-dir>');
  process.exit(2);
}

const NORMALISE = [
  [/^Evaluated .*$/gm, '<STAMP>'],
  [/\d+ min old/g, '<AGE>'],
  [/\d+ h old/g, '<AGE>'],
];
const norm = (s) => NORMALISE.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

const readReport = (dir) => {
  const p = join(dir, '_report.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const a = readReport(before);
const b = readReport(after);
if (a && b && a.date !== b.date) {
  console.error(
    `Captures are for different dates -- ${a.date} and ${b.date}. They request different day\n` +
      'pages and are not comparable. Re-run both with the same --date.',
  );
  process.exit(2);
}

const names = readdirSync(before).filter((f) => f.endsWith('.txt')).sort();
if (names.length === 0) {
  console.error(`No .txt captures in ${before}`);
  process.exit(2);
}

let same = 0;
const differing = [];

for (const name of names) {
  const bp = join(after, name);
  if (!existsSync(bp)) {
    differing.push(name);
    console.log(`  ${name} | missing from ${after}`);
    continue;
  }
  const x = norm(readFileSync(join(before, name), 'utf8')).split('\n');
  const y = norm(readFileSync(bp, 'utf8')).split('\n');
  if (x.length === y.length && x.every((l, i) => l === y[i])) {
    same++;
    continue;
  }
  differing.push(name);
  let shown = 0;
  for (let i = 0; i < Math.max(x.length, y.length) && shown < 6; i++) {
    if (x[i] !== y[i]) {
      console.log(`  ${name}:${i + 1}`);
      console.log(`    - ${(x[i] ?? '(absent)').slice(0, 150)}`);
      console.log(`    + ${(y[i] ?? '(absent)').slice(0, 150)}`);
      shown++;
    }
  }
}

console.log('');
console.log(`ui-compare: ${same} / ${names.length} captures render identical text`);
console.log(`differing:  ${differing.length}`);
process.exit(differing.length > 0 ? 1 : 0);
