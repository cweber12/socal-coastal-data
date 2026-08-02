#!/usr/bin/env node
/*
 * Discover every `unresolved` array in the repo and generate the list of them.
 *
 *   node scripts/gen-unresolved-sources.mjs            write
 *   node scripts/gen-unresolved-sources.mjs --check    verify, exit 1 if stale
 *   node scripts/gen-unresolved-sources.mjs --root D --out F   (tests only)
 *
 * Mirrors scripts/gen-spots-types.mjs, including its `--check` semantics and the
 * CRLF warning that .gitattributes exists because of.
 *
 * ---------------------------------------------------------------------------
 * Why discovery and not a list
 * ---------------------------------------------------------------------------
 *
 * `unresolved` is this repo's designated channel for stating what a value does
 * not cover. app/unresolved-sources.ts named its sources by hand, and a
 * hand-written list of files is a list that stops being complete the first time
 * somebody adds a file without editing it. That is not a hypothesis:
 *
 *   #169  shared/intertidal.json carried 3 caveats and INTERTIDAL_FILE_UNRESOLVED
 *         had zero call sites, for as long as the file existed.
 *   here  shared/gate-hours.json carries 1 and nothing has ever rendered it.
 *
 * Both were found by enumerating the files, which is what this does. One
 * forgotten file was arguably bad luck; two is a mechanism, and #132 is the
 * decision to replace the mechanism rather than wire a sixth entry by hand.
 *
 * ---------------------------------------------------------------------------
 * What is generated, and what is deliberately NOT
 * ---------------------------------------------------------------------------
 *
 * EXISTENCE is generated. Which files carry an `unresolved` array, what version
 * governs each, and how to reach the entries -- all discovered, none written
 * down. A file added tomorrow appears on the page with no edit to any component
 * and no edit to this script.
 *
 * PROSE is not. app/unresolved-sources.ts keeps an ordered map of subject lines
 * -- "The corridor swell ceiling", "The spot inventory" -- because no derivation
 * produces those and a reader is owed better than a title-cased filename. A
 * source missing from that map still renders, under a heading derived from its
 * path. The map refines what a reader sees; it can no longer decide whether they
 * see it at all, which is the whole change.
 *
 * The generated module IMPORTS each array. It never inlines the strings. That is
 * what makes "rendered verbatim" structural rather than a promise: there is no
 * second copy of a caveat anywhere in this repo for the first one to drift from,
 * and a re-worded caveat reaches the page re-worded on the next request rather
 * than on the next `npm run gen:unresolved`.
 *
 * ---------------------------------------------------------------------------
 * The trap: three modules re-export an array that a JSON file already owns
 * ---------------------------------------------------------------------------
 *
 *   activities/surf/thresholds.ts  SURF_UNRESOLVED             = FILE.unresolved
 *   shared/intertidal.generated.ts INTERTIDAL_FILE_UNRESOLVED  = FILE.unresolved
 *
 * Both match "a module exporting an array of caveats", and counting them would
 * render two sources twice and inflate the summary line by 8 -- a disclosure
 * that looks more complete than it is, which is worse than the bug this fixes.
 * So a module counts only when it ORIGINATES the array: the initialiser is an
 * array literal. `= FILE.unresolved` is a pass-through and the JSON behind it is
 * the source of record.
 *
 * core/thresholds.ts carries a third, THRESHOLDS_UNRESOLVED, in the same shape.
 * It is never reached, because `core/` is not a walked root -- only
 * `core/zones/` is -- and shared/thresholds.json is found directly. Worth
 * knowing before someone widens ROOTS to `core` and doubles a source that was
 * fine the day before.
 *
 * core/zones/surf.ts is the one module that originates one, because that zone
 * has no file -- its membership is derived from shared/spots.json's wave
 * bindings, so there is nothing to put a `unresolved` key on. Every pass-through
 * skipped is printed on every run, so the rule is visible rather than silent.
 *
 * Standard library only, like every other generator here.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * `--root` and `--out` exist for the test that proves discovery is discovery.
 *
 * #132's second acceptance criterion is that an array added to a fixture appears
 * in the output with no edit to a component. The only honest way to demonstrate
 * that is to point the real generator at a tree it has never seen and read what
 * it emits -- a test that called an exported helper would be asserting against
 * the same code path twice. Both flags default to the repo, so the committed
 * behaviour is the no-flag behaviour.
 */
const ROOT = flag('root') ?? REPO;
const OUT = flag('out') ?? join(REPO, 'app', 'unresolved-sources.generated.ts');

/** Where a source may live. `app/` is excluded: it is the consumer. */
const ROOTS = ['shared', 'core/zones', 'activities'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__pycache__', 'cache', 'out']);

/**
 * Fixtures are captured payloads, not statements this repo makes.
 *
 * A fixture that happened to contain an `unresolved` key would put an upstream's
 * words on the page as though this repo had written them, attributed to a file
 * under __fixtures__. Excluded by directory rather than by filename so a new
 * fixture cannot opt itself in.
 */
const SKIP_FIXTURE_DIR = '__fixtures__';

const toPosix = (p) => p.split(sep).join('/');

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries.sort()) {
    if (SKIP_DIRS.has(name) || name === SKIP_FIXTURE_DIR) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/* ===========================================================================
 * Discovery
 * =========================================================================== */

/**
 * Strip line and block comments, preserving offsets.
 *
 * Same device and the same reason as scripts/check-boundaries.mjs: this repo's
 * modules carry fifty-line header comments that quote code, and
 * core/zones/surf.ts's own header contains the words `SURF_ZONE_UNRESOLVED`.
 * Matching without stripping finds the sentence about the array before the
 * array.
 */
function stripComments(src) {
  const out = Array.from(src);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

const problems = [];
const jsonSources = [];
const moduleSources = [];
const passThrough = [];

for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = toPosix(relative(ROOT, file));

    if (rel.endsWith('.json')) {
      let data;
      try {
        data = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // Not this script's business. A malformed data file fails its own
        // generator, with a better message than this one could give.
        continue;
      }
      if (!Array.isArray(data?.unresolved)) continue;

      /*
       * An `unresolved` that is not an array of prose is a different key wearing
       * the same name, and rendering it would put objects on the page as
       * "[object Object]". shared/intertidal.json has BOTH -- a top-level array
       * of prose and a membership.unresolved of spot records -- which is exactly
       * how close the two get.
       */
      if (!data.unresolved.every((e) => typeof e === 'string')) {
        problems.push(`${rel}: unresolved is an array but not every entry is a string`);
        continue;
      }
      if (data.unresolved.length === 0) continue;
      if (typeof data.version !== 'string') {
        problems.push(`${rel}: carries ${data.unresolved.length} unresolved entries and no version`);
        continue;
      }
      jsonSources.push({ rel, count: data.unresolved.length, version: data.version });
      continue;
    }

    if (!rel.endsWith('.ts') && !rel.endsWith('.tsx')) continue;
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;

    const clean = stripComments(readFileSync(file, 'utf8'));
    const re =
      /export\s+const\s+([A-Za-z0-9_$]*UNRESOLVED[A-Za-z0-9_$]*)\s*:\s*readonly\s+string\[\]\s*=\s*(\[|[A-Za-z_$])/g;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const [, symbol, initialiser] = m;
      if (initialiser !== '[') {
        passThrough.push({ rel, symbol });
        continue;
      }
      moduleSources.push({ rel, symbol });
    }
  }
}

/*
 * A symbol exported under the same name from two modules would produce a
 * generated file that does not compile, which is a safe failure -- but it would
 * fail at typecheck with a message about an import, three steps after the cause.
 */
const bySymbol = new Map();
for (const s of moduleSources) {
  if (bySymbol.has(s.symbol)) {
    problems.push(`${s.symbol} is exported by both ${bySymbol.get(s.symbol)} and ${s.rel}`);
  }
  bySymbol.set(s.symbol, s.rel);
}

if (problems.length > 0) {
  console.error('gen-unresolved-sources: cannot generate\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

/* ===========================================================================
 * Emitting
 * =========================================================================== */

/**
 * A unique, stable identifier for a JSON import, derived from the whole path.
 *
 * `shared/thresholds.json` and `activities/surf/thresholds.json` both end in
 * `thresholds.json`, so a basename-derived identifier collides between the two
 * files this repo is most likely to confuse. The full path cannot.
 */
function identifierFor(rel) {
  const words = rel
    .replace(/\.json$/, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return (
    words
      .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join('') + 'Json'
  );
}

const jsonImports = jsonSources.map((s) => ({ ...s, id: identifierFor(s.rel) }));

const moduleImports = moduleSources.map((s) => ({
  ...s,
  // '@/core/zones/surf.ts' -> '@/core/zones/surf'
  spec: `@/${s.rel.replace(/\.tsx?$/, '')}`,
}));

const importLines = [
  ...jsonImports.map((s) => `import ${s.id} from '@/${s.rel}';`),
  ...moduleImports.map((s) => `import { ${s.symbol} } from '${s.spec}';`),
].join('\n');

/*
 * JSON sources first, then modules; each group in walk order, which is
 * alphabetical by path. This order is NOT what a reader sees -- app/
 * unresolved-sources.ts orders the render, because the order of a disclosure is
 * an argument and an argument is prose. What this order has to be is STABLE, so
 * that `--check` fails on a content change and never on a directory listing.
 */
const entryLines = [
  ...jsonImports.map(
    (s) =>
      `  { file: '${s.rel}', version: ${s.id}.version, entries: ${s.id}.unresolved },`,
  ),
  ...moduleImports.map(
    (s) => `  { file: '${s.rel}', version: null, entries: ${s.symbol} },`,
  ),
].join('\n');

/*
 * JSON entries only, and the label says so.
 *
 * A module's array is TypeScript this script does not execute, so its length is
 * known at runtime and not here. Reporting a total that silently omitted
 * core/zones/surf.ts's three would be a count that reads as complete and is not,
 * which is the failure mode this whole issue is about.
 */
const jsonEntryCount = jsonSources.reduce((n, s) => n + s.count, 0);

const out = `// GENERATED FILE -- do not edit by hand.
//
// Generator: scripts/gen-unresolved-sources.mjs
// Regen:     npm run gen:unresolved      Verify: npm run gen:unresolved:check
//
// Every \`unresolved\` array under shared/, core/zones/ and activities/, found by
// walking those directories rather than by anyone remembering to add a line.
// ${jsonSources.length} JSON ${jsonSources.length === 1 ? 'file' : 'files'} and ${moduleSources.length} ${moduleSources.length === 1 ? 'module' : 'modules'} that originate one.
//
// The entries are IMPORTED, never copied. There is no second wording of any
// caveat in this file for the first one to drift from -- which is what lets
// core/components/unresolved.tsx promise a reader that it quotes the files
// verbatim.
//
// This file says WHICH sources exist. app/unresolved-sources.ts says what each
// one is called and in what order they are argued, and a source it does not
// name still renders. Adding a data file with an \`unresolved\` array requires no
// edit to either.

${importLines}

/** One discovered source. \`version\` is null where the source is a module, which has none. */
export interface DiscoveredUnresolved {
  /** Repo-relative path, so a reader can go and read the whole thing. */
  file: string;
  version: string | null;
  entries: readonly string[];
}

export const DISCOVERED_UNRESOLVED: readonly DiscoveredUnresolved[] = [
${entryLines}
];
`;

/* ===========================================================================
 * --check
 *
 * LF-normalised, for the reason scripts/gen-spots-types.mjs sets out at length:
 * this compares generator output against a file git handed back, git is entitled
 * to rewrite line endings on the way, and a drift guard that cries wolf gets
 * ignored -- which costs more than the drift it was watching for.
 * =========================================================================== */

const stripCr = (s) => s.replace(/\r\n/g, '\n');

function firstDifference(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return {
        line: i + 1,
        committed: al[i] === undefined ? '(end of file)' : al[i],
        generated: bl[i] === undefined ? '(end of file)' : bl[i],
      };
    }
  }
  return null;
}

const summary =
  `${jsonSources.length + moduleSources.length} sources ` +
  `(${jsonSources.length} JSON, ${moduleSources.length} module), ` +
  `${jsonEntryCount} entries in the JSON files`;

/*
 * Printed on every run, passing or failing.
 *
 * A pass-through is a module this script deliberately did not count, and the
 * reason it did not is a rule written in this file's header rather than
 * something visible in the output. Printing them means a reviewer can see that
 * three modules were considered and skipped, instead of having to trust that
 * they were.
 */
for (const p of passThrough) {
  console.log(`gen-unresolved-sources: ${p.rel} ${p.symbol} re-exports a file's array; not counted`);
}

if (args.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('app/unresolved-sources.generated.ts is missing. Run: npm run gen:unresolved');
    process.exit(1);
  }

  const diff = firstDifference(stripCr(current), stripCr(out));

  if (diff) {
    console.error(
      `app/unresolved-sources.generated.ts is stale (${summary}).\n\n` +
        `  first difference at line ${diff.line}\n` +
        `    committed: ${diff.committed.slice(0, 160)}\n` +
        `    generated: ${diff.generated.slice(0, 160)}\n\n` +
        `A source appearing here that you did not add is not a bug -- it is a data\n` +
        `file whose caveats reach no reader yet.\n\n` +
        `Run: npm run gen:unresolved`,
    );
    process.exit(1);
  }

  if (current !== out) {
    console.warn(
      'app/unresolved-sources.generated.ts matches, but its line endings differ from what ' +
        'this generator writes (it writes LF).\n' +
        'The file is current -- do NOT run gen:unresolved, which would rewrite the whole ' +
        'file. Run: git add --renormalize .',
    );
  }

  console.log(`app/unresolved-sources.generated.ts is current (${summary}).`);
  process.exit(0);
}

writeFileSync(OUT, out);
console.log(`Wrote ${toPosix(relative(REPO, OUT))}: ${summary}.`);
