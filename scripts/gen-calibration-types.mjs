/**
 * Generate shared/calibration.generated.ts from shared/calibration.json.
 *
 *   node scripts/gen-calibration-types.mjs            write
 *   node scripts/gen-calibration-types.mjs --check    verify, exit 1 if stale
 *
 * Mirrors scripts/gen-spots-types.mjs, including its `--check` semantics and the
 * CRLF warning that .gitattributes exists because of.
 *
 * ---------------------------------------------------------------------------
 * What the types are FOR
 * ---------------------------------------------------------------------------
 *
 * The same thing county_station's types are for in shared/spots.generated.ts: to
 * make the repo's null-carries-a-reason rule the compiler's problem rather than
 * a convention a reader is trusted to remember.
 *
 * Five of eight spots refuse on current data. A refused spot has no rate and a
 * `null_reason`. If those were `{ rate: number | null; null_reason: string | null }`
 * a consumer could read the rate, get null, and render it as 0% -- which would
 * put "0% of visitors saw anything" on a page where the truth is "we decline to
 * say". So the shape is a DISCRIMINATED UNION on `published`, and there is no
 * member in which a rate stands without a reason beside it. A consumer that
 * reads a rate without narrowing does not typecheck.
 *
 * The generator validates before it generates. A source file that violates the
 * rule fails here rather than producing types that quietly encode the violation.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../shared/calibration.json', import.meta.url));
const OUT = fileURLToPath(new URL('../shared/calibration.generated.ts', import.meta.url));

const data = JSON.parse(readFileSync(SRC, 'utf8'));

/* ===========================================================================
 * Validate the source before generating from it
 * ========================================================================= */

const problems = [];

const required = [
  'version',
  'taxa_version',
  'spots_version',
  'pulled_at',
  'corpus_from',
  'radius_m',
  'tide_station',
  'datum',
  'content_hash',
  'bin_edges',
  'constants',
  'spots',
];
for (const key of required) {
  if (data[key] === undefined) problems.push(`missing top-level key: ${key}`);
}

if (data.datum !== 'MLLW') {
  problems.push(
    `datum is ${JSON.stringify(data.datum)}, not MLLW. Every bin edge is feet above MLLW and ` +
      'lib/windows.ts compares against the same datum; another one would shift every bin.',
  );
}

if (!Array.isArray(data.bin_edges) || data.bin_edges.length < 2) {
  problems.push('bin_edges must be an array of at least two edges');
} else {
  for (let i = 1; i < data.bin_edges.length; i++) {
    if (!(data.bin_edges[i] > data.bin_edges[i - 1])) {
      problems.push(`bin_edges are not strictly increasing at index ${i}`);
    }
  }
}

const slugs = [];
for (const spot of data.spots ?? []) {
  slugs.push(spot.slug);

  // The rule this file exists to enforce, checked on the source too: a refusal
  // must carry its reason, and a publication must not carry one.
  if (spot.published === true && spot.null_reason !== null) {
    problems.push(`${spot.slug}: published, but carries a null_reason`);
  }
  if (spot.published === false && (typeof spot.null_reason !== 'string' || spot.null_reason === '')) {
    problems.push(
      `${spot.slug}: refused without a null_reason. A null rate that does not say why is ` +
        'exactly what this file forbids.',
    );
  }
  if (!Array.isArray(spot.bins) || spot.bins.length !== data.bin_edges.length - 1) {
    problems.push(
      `${spot.slug}: has ${spot.bins?.length ?? 0} bins against ${data.bin_edges.length - 1} ` +
        'implied by bin_edges',
    );
  }
  for (const [i, bin] of (spot.bins ?? []).entries()) {
    if (bin.visits === 0 && bin.rate !== null) {
      problems.push(`${spot.slug} bin ${i}: no visits, but carries a rate`);
    }
    if (bin.visits > 0 && bin.rate === null) {
      problems.push(`${spot.slug} bin ${i}: has visits but no rate`);
    }
    if (bin.hits > bin.visits) {
      problems.push(`${spot.slug} bin ${i}: ${bin.hits} hits from ${bin.visits} visits`);
    }
  }
  if (!spot.query) problems.push(`${spot.slug}: no query. A rate without a reproducible source is not a deliverable.`);
}

if (problems.length > 0) {
  console.error(`shared/calibration.json has ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/* ===========================================================================
 * Generate
 * ========================================================================= */

const union = (values) => values.map((v) => `'${v}'`).join(' | ');

const out = `// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/calibration.json (version ${data.version}, pulled ${data.pulled_at})
// Generator: scripts/gen-calibration-types.mjs
// Regen:     npm run gen:calibration      Verify: npm run gen:calibration:check
//
// Editing this file by hand puts the types out of step with the calibration of
// record. Re-run the pipeline and regenerate.

import calibrationJson from './calibration.json';

/** Slugs the calibration ran against. Not every spot publishes a rate. */
export type CalibratedSlug = ${union(slugs)};

/** Bin edges, feet above ${data.datum} at station ${data.tide_station}. */
export const BIN_EDGES_FT: readonly number[] = ${JSON.stringify(data.bin_edges)};

export const CALIBRATION_VERSION = '${data.version}';
export const TAXA_VERSION = '${data.taxa_version}';
export const CALIBRATION_PULLED_AT = '${data.pulled_at}';
export const CALIBRATION_CONTENT_HASH = '${data.content_hash}';
export const CALIBRATION_DATUM = '${data.datum}';
export const CALIBRATION_TIDE_STATION = '${data.tide_station}';
export const CALIBRATION_RADIUS_M = ${data.radius_m};
export const CALIBRATION_CORPUS_FROM = '${data.corpus_from}';

/** Visits a bin needs before any gate may read it. */
export const USABLE_BIN_MIN_VISITS = ${data.constants.usable_bin_min_visits};

/**
 * One bin's observed record.
 *
 * \`rate\` is null exactly when \`visits\` is 0, which the generator validates. A
 * bin with visits always has a rate, and the rate is always \`hits / visits\` --
 * a count, not an estimate. \`usable\` is false below ${data.constants.usable_bin_min_visits} visits; such a bin is
 * still reported, and no refusal gate reads it.
 */
export interface CalibrationBin {
  lo_ft: number;
  hi_ft: number;
  visits: number;
  hits: number;
  rate: number | null;
  usable: boolean;
}

/**
 * A spot's calibration, as a discriminated union on \`published\`.
 *
 * This is the whole point of generating a type for this file. There is no member
 * in which a rate stands without the reason it might be missing:
 *
 *   published: true   -> bins carry rates, null_reason is \`null\`
 *   published: false  -> null_reason is a \`string\`, and the bins are diagnostic
 *                        counts only, NOT a rate table to render
 *
 * A consumer that reads \`spot.bins\` without narrowing on \`published\` first does
 * not typecheck, which is what stops a refusal being rendered as a pass. Five of
 * eight spots refuse on the current corpus, so this is the common case rather
 * than the edge one.
 */
export type SpotCalibration =
  | {
      slug: CalibratedSlug;
      published: true;
      null_reason: null;
      visits: number;
      records: number;
      observers: number;
      amplitude_ratio: number;
      bins: CalibrationBin[];
      query: string;
    }
  | {
      slug: CalibratedSlug;
      published: false;
      /** Required. States every criterion the spot failed and by how much. */
      null_reason: string;
      visits: number;
      records: number;
      observers: number;
      amplitude_ratio: number | null;
      /**
       * Present, but they are NOT a rate table. A refused spot's bins exist so a
       * report can show why it refused; rendering them would publish the number
       * the refusal exists to withhold.
       */
      bins: CalibrationBin[];
      query: string;
    };

interface CalibrationFile {
  version: string;
  taxa_version: string;
  spots_version: string;
  pulled_at: string;
  corpus_from: string;
  radius_m: number;
  tide_station: string;
  datum: string;
  tide_years: string;
  content_hash: string;
  bin_edges: number[];
  constants: {
    usable_bin_min_visits: number;
    min_usable_bins: number;
    min_concordant_pairs: number;
    min_amplitude_ratio: number;
    max_single_observer_share: number;
  };
  queries: string[];
  spots: SpotCalibration[];
}

const FILE = calibrationJson as unknown as CalibrationFile;

export const CALIBRATION: readonly SpotCalibration[] = FILE.spots;

export const CALIBRATION_BY_SLUG: Readonly<Record<CalibratedSlug, SpotCalibration>> =
  Object.fromEntries(FILE.spots.map((s) => [s.slug, s])) as Record<
    CalibratedSlug,
    SpotCalibration
  >;

/** Slugs that published a rate table. ${data.spots.filter((s) => s.published).length} of ${data.spots.length} on this corpus. */
export const PUBLISHED_SLUGS: readonly CalibratedSlug[] = ${JSON.stringify(
  data.spots.filter((s) => s.published).map((s) => s.slug),
)};

export const CALIBRATION_QUERIES: readonly string[] = FILE.queries;
`;

/* ===========================================================================
 * --check
 * ========================================================================= */

const stripCr = (s) => s.replace(/\r\n/g, '\n');

function firstDifference(a, b) {
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return { line: i + 1, committed: left[i] ?? '(end of file)', generated: right[i] ?? '(end of file)' };
    }
  }
  return null;
}

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('shared/calibration.generated.ts is missing. Run: npm run gen:calibration');
    process.exit(1);
  }

  const diff = firstDifference(stripCr(current), stripCr(out));
  if (diff) {
    console.error(
      `shared/calibration.generated.ts is stale relative to shared/calibration.json ` +
        `(version ${data.version}, pulled ${data.pulled_at}).\n\n` +
        `  first difference at line ${diff.line}\n` +
        `    committed: ${diff.committed.slice(0, 160)}\n` +
        `    generated: ${diff.generated.slice(0, 160)}\n\n` +
        `Run: npm run gen:calibration`,
    );
    process.exit(1);
  }

  if (current !== out) {
    // The .gitattributes lesson, restated. The generator writes LF; a Windows
    // checkout with core.autocrlf=true used to hand back CRLF, which made a
    // current file look stale and made "fixing" it rewrite every line.
    console.warn(
      'shared/calibration.generated.ts matches shared/calibration.json, but its line endings ' +
        'differ from what this generator writes (it writes LF).\n' +
        'The types are current -- do NOT run gen:calibration, which would rewrite the whole ' +
        'file. Run: git add --renormalize .',
    );
  }

  console.log(
    `shared/calibration.generated.ts is current (${data.spots.length} spots, ` +
      `${data.spots.filter((s) => s.published).length} published, version ${data.version}).`,
  );
  process.exit(0);
}

writeFileSync(OUT, out);
console.log(
  `Wrote shared/calibration.generated.ts from calibration.json ${data.version}: ` +
    `${data.spots.length} spots, ${data.spots.filter((s) => s.published).length} published, ` +
    `${data.spots.filter((s) => !s.published).length} refused.`,
);
