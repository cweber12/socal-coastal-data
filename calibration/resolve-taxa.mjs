/**
 * Resolve, or re-verify, every taxon id in calibration/target_taxa.json.
 *
 *   node calibration/resolve-taxa.mjs --check     re-resolve and compare, exit 1 on drift
 *   node calibration/resolve-taxa.mjs --write     re-resolve and rewrite the ids
 *
 * Issue #32 requires that taxon ids be "resolved from the API, never hand-typed,
 * recorded with what they resolved from". A comment saying so is a promise; this
 * is the check. Every entry carries `resolved_from_name`, and this script asks
 * the API for that exact name and asserts the id it gets back.
 *
 * Deliberately NOT in CI. It reaches the network, and CI in this repo is offline
 * by design -- lib/ runs against captured fixtures precisely so a test that needs
 * a live endpoint is a design regression rather than a flake. Taxon ids are also
 * about the most stable thing iNaturalist serves; this is a tool for the day
 * somebody proposes changing the list, not a per-push gate.
 *
 * Standard library only, like every other script here.
 */

import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('./target_taxa.json', import.meta.url);
const USER_AGENT =
  'socal-coastal-data/0.1 (+https://github.com/cweber12/socal-coastal-data) calibration';

/** iNaturalist asks for about one request a second. Fourteen names is fourteen seconds. */
const REQUEST_INTERVAL_MS = 1100;

const mode = process.argv.includes('--write') ? 'write' : 'check';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The id iNaturalist gives for an exact name.
 *
 * Rejects anything but exactly one active exact-name match. `q=` is a fuzzy
 * search, so "Anthopleura sola" also returns its congeners -- taking
 * `results[0]` would make the id depend on iNaturalist's relevance ranking,
 * which is not a stable thing to pin a legal-adjacent dataset to.
 */
async function resolveName(name) {
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(name)}&per_page=10`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} from ${url}`);
  const payload = await response.json();
  if (!Array.isArray(payload.results)) {
    throw new Error(`${name}: no results array. The taxa endpoint has drifted.`);
  }

  const exact = payload.results.filter((t) => t.name === name && t.is_active !== false);
  if (exact.length === 0) {
    throw new Error(
      `${name}: no active exact-name match among ${payload.results.length} results ` +
        `(${payload.results.map((t) => t.name).join(', ') || 'none'}).`,
    );
  }
  if (exact.length > 1) {
    throw new Error(
      `${name}: ${exact.length} active exact-name matches (ids ${exact.map((t) => t.id).join(', ')}). ` +
        'Ambiguous, so nothing is pinned.',
    );
  }
  return { id: exact[0].id, rank: exact[0].rank, commonName: exact[0].preferred_common_name ?? null };
}

const file = JSON.parse(await readFile(FILE, 'utf8'));

/** Every entry across all three lists that claims to have been resolved. */
const entries = [...file.targets, ...file.denominator, ...file.rejected].filter(
  (e) => e.resolved_from_name !== null && e.resolved_from_name !== undefined,
);

const problems = [];
let first = true;
for (const entry of entries) {
  if (!first) await sleep(REQUEST_INTERVAL_MS);
  first = false;

  let resolved;
  try {
    resolved = await resolveName(entry.resolved_from_name);
  } catch (cause) {
    problems.push(String(cause.message ?? cause));
    continue;
  }

  const idMatches = entry.taxon_id === resolved.id;
  const rankMatches = entry.rank === undefined || entry.rank === resolved.rank;

  if (mode === 'write') {
    entry.taxon_id = resolved.id;
    if (entry.rank !== undefined) entry.rank = resolved.rank;
  } else {
    if (!idMatches) {
      problems.push(
        `${entry.resolved_from_name}: file says ${entry.taxon_id}, API says ${resolved.id}.`,
      );
    }
    if (!rankMatches) {
      problems.push(
        `${entry.resolved_from_name}: file says rank ${entry.rank}, API says ${resolved.rank}. ` +
          'Rank is load-bearing -- a genus target matches through ancestor_ids and a species does not.',
      );
    }
  }

  process.stdout.write(
    `${entry.resolved_from_name.padEnd(32)} ${String(resolved.id).padStart(7)}  ` +
      `${String(resolved.rank).padEnd(8)} ${idMatches && rankMatches ? 'ok' : 'DRIFT'}\n`,
  );
}

if (mode === 'write') {
  await writeFile(FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  console.log(`\nRewrote ${entries.length} ids into calibration/target_taxa.json.`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\ncalibration/target_taxa.json is FROZEN. If an id genuinely moved upstream, that is a\n' +
      'finding for a human and a new version of the file, not something to rewrite mid-run.',
  );
  process.exit(1);
}

console.log(`\nAll ${entries.length} taxon ids agree with the API.`);
