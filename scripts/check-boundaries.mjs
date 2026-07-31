#!/usr/bin/env node
/*
 * Fails when one part of the repo imports another it is not allowed to.
 *
 * The architecture in PRD #101 is a set of directed edges between slices: zones
 * own facts, activities own judgement, `shared/` imports nothing, and producers
 * under `tools/` are never imported by app code. Every one of those is a claim
 * about import direction, and a claim about import direction that is only
 * written in a README is a claim nothing checks.
 *
 * This runs before the moves in #121, #122 and #123, against the layout as it
 * stands today, so those moves are enforced rather than reviewed by eye. The
 * table below is data: each move PR replaces the rows it changes. A row is added
 * when the directory it names exists, never in anticipation of one.
 *
 *   node scripts/check-boundaries.mjs   # exit 1 on any forbidden edge
 *
 * ---------------------------------------------------------------------------
 * What this refuses to assume
 * ---------------------------------------------------------------------------
 *
 * `import type` counts as an edge. A type-only import of an activity from core/
 * is the same architectural claim as a value import -- it is core/ knowing an
 * activity's shape -- and it is the form the violation is most likely to take,
 * because it costs nothing at runtime and so reads as harmless.
 *
 * Comments are stripped before matching, with a scanner rather than a regex.
 * This repo's files carry long header comments that name other modules by path,
 * and its source carries URLs inside string literals. A regex that treats `//`
 * as a comment start corrupts every `https://` specifier it meets, and one that
 * ignores comments entirely reports edges that do not exist. Both failures are
 * silent in the direction that matters: they make the check untrustworthy while
 * it still exits 0.
 *
 * Template literal contents are blanked, single- and double-quoted strings are
 * not. That is not a heuristic: an ES import declaration's specifier must be a
 * StringLiteral, so a backtick can never hold a real static import. What a
 * backtick DOES hold in this repo is codegen -- scripts/gen-spots-types.mjs
 * emits the literal text `import spotsJson from './spots.json'` into the file it
 * generates. Reading that as an edge would report the generator as importing
 * what it writes.
 *
 * An unresolvable specifier is a hard error, not a skip. A path this cannot
 * resolve is a path it cannot check, and a checker that quietly passes what it
 * could not read is the same failure as a 200 carrying an empty payload.
 *
 * That includes a specifier that resolves to a slice but not to a FILE. Classing
 * an edge without confirming its target exists is how a checker reports a clean
 * graph over paths that are simply wrong: during #121, `../../lib/tide.ts` from
 * a moved tools/calibration/src/ resolved to `tools/lib/tide.ts`, which is a
 * perfectly legal `tools -> tools` edge to a file that does not exist. The edge
 * count printed at the end is only trustworthy if every edge in it is real.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ===========================================================================
 * The table
 * =========================================================================== */

/**
 * Allowed edges, as `slice -> the slices it may import`.
 *
 * Keys are path prefixes and the longest match wins, so a future
 * `core/zones` row can be stricter than its own `core` row without the
 * matcher changing. Self is listed explicitly rather than implied: a slice that
 * may not import its own siblings is a rule this repo will want (`core/zones`
 * may not import another zone), and it cannot be expressed if self is a
 * hardcoded exemption.
 *
 * `tools` appears in no other slice's list, and that absence IS the producer
 * rule -- tools are things this repo runs to make data, and nothing the app
 * renders may depend on one. It is stated as an absence rather than as a
 * separate deny-list because a single table with one direction is checkable;
 * two tables that can disagree are not.
 *
 * `tools/lidar-recon/` is Python and has no JavaScript imports to walk. Its
 * relationship to `shared/spots.json` is a file read, not an import, and is
 * checked by the probes themselves -- see #124, where that read is the largest
 * silent-failure risk in the PRD.
 */
const ALLOWED = {
  // The composition root. It may import every slice -- that is what makes it the
  // composition root -- except a producer.
  app: ['app', 'components', 'lib', 'shared'],

  // Presentation. Reads the domain, never the other way round: `lib -> components`
  // would put rendering inside the predicate.
  components: ['components', 'lib', 'shared'],

  // The domain. Depends on the data contract and on itself, and on nothing that
  // renders.
  lib: ['lib', 'shared'],

  // The cross-language contract. Imports nothing but its own JSON. Anything it
  // learned about `lib` would be a rule the Python side cannot see.
  shared: ['shared'],

  // The producers. They may read the domain -- the calibration pipeline reuses
  // the CO-OPS parser rather than growing a second one, which is the whole
  // reason its numbers are comparable -- but nothing may read them back.
  tools: ['tools', 'lib', 'shared'],

  // Codegen and checks. Node standard library only, deliberately: a generator
  // that imports the types it generates cannot fail honestly.
  scripts: [],
};

/**
 * Edges that exist today, that the architecture forbids, and that a named issue
 * removes.
 *
 * The alternative was to widen `ALLOWED` until the repo passed, which would ship
 * a checker that permits the exact edge it exists to forbid, on its first day,
 * with nothing recording that it was a concession. A temporary edge is the same
 * device as a `DEAD` upstream source: written down, attributed, and carrying the
 * condition under which it goes away.
 *
 * Two rules keep this list from becoming a permanent amnesty:
 *
 *   - every entry is printed on every run, passing or failing, so it is visible
 *     in CI output rather than discoverable only by reading this file;
 *   - an entry that is no longer exercised FAILS the check. A concession that
 *     has been fixed but not deleted is how a list like this rots into a set of
 *     rules nobody can tell are still load-bearing.
 */
const TEMPORARY = [];

/** Directories walked. Anything outside these is not this check's business. */
const ROOTS = Object.keys(ALLOWED);

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__pycache__', 'cache', 'out']);

/* ===========================================================================
 * Reading source
 * =========================================================================== */

/**
 * Replace comments with spaces, preserving every byte offset and line break.
 *
 * Offsets are preserved so the line number reported for a violation is the line
 * the import is actually on. A stripper that collapsed comments would report
 * every edge at the wrong line, in a repo where the header comment above an
 * import block is routinely fifty lines long.
 *
 * String and template literals are tracked, because `'https://...'` contains
 * `//` and is not a comment. Escapes are honoured inside strings so a trailing
 * backslash cannot swallow the closing quote.
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
      // Template contents are blanked; quoted-string contents are kept, because
      // a real specifier lives inside quotes and codegen output lives inside
      // backticks. Nested templates inside `${...}` would end the span early --
      // this repo has none, and the failure direction is a false positive that
      // shows up as a named edge, not a silent pass.
      const blank = quote === '`';
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          if (blank) {
            if (src[i] !== '\n') out[i] = ' ';
            if (src[i + 1] !== '\n') out[i + 1] = ' ';
          }
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        if (blank && src[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Every module specifier in a file, with the line it sits on.
 *
 * Covers the forms this repo actually uses and the ones it could grow into:
 * `import x from`, `import {} from`, `import type {} from`, `import * as`, bare
 * `import 'x'`, `export {} from`, `export * from`, and dynamic `import('x')`.
 */
function specifiers(src) {
  const clean = stripComments(src);
  const found = [];

  /*
   * The clause between `import`/`export` and `from` is restricted to the
   * characters an import clause can legally contain -- identifiers, braces,
   * commas, whitespace, `*`. It deliberately cannot match `=`, `;`, `(` or `:`.
   *
   * Without that restriction a lazy `[\s\S]*?` walks from an unrelated `export`
   * keyword to the next `from` anywhere later in the file, and reports a real
   * specifier against the wrong line. That was not hypothetical: the first
   * version of this script reported an import appended to the END of
   * shared/spots.generated.ts as sitting on line 13, having started its match at
   * an `export type` two hundred lines earlier.
   */
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\w${}\s,*]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(clean)) !== null) {
      // The specifier's own offset, not the statement's, so a multi-line import
      // block reports the line the path is actually written on.
      const at = m.index + m[0].lastIndexOf(m[1]);
      const line = clean.slice(0, at).split('\n').length;
      const key = `${line}:${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ spec: m[1], line });
    }
  }

  return found;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

/* ===========================================================================
 * Resolving a specifier to a slice
 * =========================================================================== */

const toPosix = (p) => p.split(sep).join('/');

/**
 * The slice a repo-relative path belongs to, by longest declared prefix.
 *
 * Returns null for a path under no declared root, which means "not this check's
 * business" -- not "allowed". The two are different and the caller treats them
 * differently.
 */
function sliceOf(relPath) {
  const p = toPosix(relPath);
  let best = null;
  for (const key of ROOTS) {
    if (p === key || p.startsWith(`${key}/`)) {
      if (best === null || key.length > best.length) best = key;
    }
  }
  return best;
}

/**
 * Resolve one specifier to a repo-relative path, or null if it is external.
 *
 * `@/` is the alias tsconfig.json maps to the repo root and vitest.config.ts
 * mirrors. It is resolved here rather than treated as external, because every
 * cross-slice import in `app/` and `components/` is written in that form -- an
 * alias-blind checker would pass the entire frontend without reading an edge.
 */
function resolveSpec(spec, fromFile) {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    return toPosix(relative(ROOT, resolve(dirname(fromFile), spec)));
  }
  return null;
}

/**
 * The suffixes a specifier may omit. `''` first, because this repo's
 * tools/calibration/ imports name the file extension explicitly -- it runs under
 * `node --experimental-strip-types`, which resolves the way the runtime does.
 */
const CANDIDATE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mjs',
  '.js',
  '.jsx',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.mjs',
];

function pointsAtAFile(relTarget) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    try {
      if (statSync(join(ROOT, relTarget + suffix)).isFile()) return true;
    } catch {
      /* next candidate */
    }
  }
  return false;
}

/* ===========================================================================
 * The check
 * =========================================================================== */

const violations = [];
const unresolved = [];
let filesScanned = 0;
let edgesChecked = 0;

for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    filesScanned++;
    const rel = toPosix(relative(ROOT, file));
    const from = sliceOf(rel);
    if (from === null) continue;

    const src = readFileSync(file, 'utf8');

    for (const { spec, line } of specifiers(src)) {
      const target = resolveSpec(spec, file);
      if (target === null) continue;

      // A relative specifier that climbs out of the repo is a path this cannot
      // check. Reported, never skipped.
      if (target.startsWith('..')) {
        unresolved.push(`${rel}:${line}  ${spec}  escapes the repo root`);
        continue;
      }

      const to = sliceOf(target);
      if (to === null) continue;

      // Confirm the target is a real file before classing the edge. A path that
      // lands in a legal slice but on nothing is not a passing edge, it is an
      // unchecked one.
      if (!pointsAtAFile(target)) {
        unresolved.push(`${rel}:${line}  ${spec}  resolves to ${target}, which does not exist`);
        continue;
      }

      edgesChecked++;
      if (ALLOWED[from].includes(to)) continue;

      const excused = TEMPORARY.find((t) => t.from === from && t.to === to);
      if (excused) {
        excused.uses = (excused.uses ?? 0) + 1;
        continue;
      }

      violations.push({ rel, line, spec, from, to });
    }
  }
}

if (unresolved.length > 0) {
  console.error('Specifiers that could not be resolved:\n');
  for (const u of unresolved) console.error(`  ${u}`);
  console.error('');
}

if (violations.length > 0) {
  console.error(
    `check-boundaries: ${violations.length} forbidden ` +
      `${violations.length === 1 ? 'edge' : 'edges'}\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.from} -> ${v.to} is not an allowed edge`);
    console.error(`    ${v.rel}:${v.line}`);
    console.error(`    imports '${v.spec}'`);
    console.error(`    ${v.from} may import: ${ALLOWED[v.from].join(', ') || '(nothing)'}\n`);
  }
  process.exit(1);
}

/*
 * A temporary edge nobody uses any more is a rule that has quietly stopped being
 * load-bearing. Deleting the row is the last step of the fix, and this is what
 * makes anyone do it.
 */
const stale = TEMPORARY.filter((t) => !t.uses);
if (stale.length > 0) {
  console.error('check-boundaries: temporary edges that are no longer used\n');
  for (const t of stale) {
    console.error(`  ${t.from} -> ${t.to} is declared TEMPORARY for #${t.issue}, and is unused.`);
    console.error('    Delete the entry from TEMPORARY in this file.\n');
  }
  process.exit(1);
}

if (unresolved.length > 0) process.exit(1);

for (const t of TEMPORARY) {
  console.log(
    `check-boundaries: TEMPORARY ${t.from} -> ${t.to} ` +
      `(${t.uses} ${t.uses === 1 ? 'import' : 'imports'}), removed by #${t.issue}`,
  );
  console.log(`  ${t.why}`);
}

console.log(
  `check-boundaries: ${filesScanned} files, ${edgesChecked} internal edges, ` +
    `${ROOTS.length} slices declared, ${TEMPORARY.length} temporary. No forbidden edges.`,
);
