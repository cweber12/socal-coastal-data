#!/usr/bin/env node
/*
 * Generate shared/intertidal.generated.ts from shared/intertidal.json.
 *
 *   node scripts/gen-intertidal-types.mjs            write
 *   node scripts/gen-intertidal-types.mjs --check    verify, exit 1 if stale
 *
 * Mirrors scripts/gen-spots-types.mjs and scripts/gen-calibration-types.mjs,
 * including their `--check` semantics and the CRLF warning .gitattributes
 * exists because of.
 *
 * ---------------------------------------------------------------------------
 * What is checked here that nothing else can check
 * ---------------------------------------------------------------------------
 *
 * This is the only place the zone file and the spot inventory are read
 * together, so it is the only place that can enforce the rule the three-way
 * membership exists for: EVERY spot is in EXACTLY ONE bucket. A spot in no
 * bucket is invisible to the zone -- which is the failure #126 is about, one
 * layer down -- and a spot in two buckets means the file contradicts itself
 * about whether a reef is there. Neither is detectable from either file alone.
 *
 * It also enforces the promotion rule from tools/calibration/floor-calibration.md
 * section 7. `floor_confidence: "verified"` is the one value in this file that
 * would tell a reader a floor has been checked, and until now nothing stopped it
 * being typed in. It is inert today -- all 8 members are `low` -- and it is here
 * so that it is inert because the ledger says so rather than because nobody has
 * tried.
 *
 * Node standard library only, like the other two generators: a generator that
 * imports the types it generates cannot fail honestly.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../shared/intertidal.json', import.meta.url));
const SPOTS_SRC = fileURLToPath(new URL('../shared/spots.json', import.meta.url));
const OUT = fileURLToPath(new URL('../shared/intertidal.generated.ts', import.meta.url));

const data = JSON.parse(readFileSync(SRC, 'utf8'));
const spotsFile = JSON.parse(readFileSync(SPOTS_SRC, 'utf8'));

/* ===========================================================================
 * Validate the source before generating from it
 * ========================================================================= */

const problems = [];

for (const key of ['version', 'generated', 'zone', 'corridor', '_provenance', 'conventions', '_schema', 'membership', 'unresolved']) {
  if (data[key] === undefined) problems.push(`missing top-level key: ${key}`);
}

/*
 * A floor is a height above a datum, compared in activities/tidepool/policy.ts
 * against CO-OPS predictions requested in MLLW feet. A file on another datum
 * would shift every floor by the offset between them, silently and in whichever
 * direction that offset happens to run. Same guard shared/calibration.json
 * carries, for the same reason.
 */
if (data.conventions?.datum !== 'MLLW') {
  problems.push(
    `conventions.datum is ${JSON.stringify(data.conventions?.datum)}, not MLLW. Every floor is ` +
      'feet above MLLW and the window predicate compares it against MLLW predictions.',
  );
}
if (data.conventions?.floor_units !== 'ft') {
  problems.push(`conventions.floor_units is ${JSON.stringify(data.conventions?.floor_units)}, not ft`);
}

const BUCKETS = ['members', 'not_in_zone', 'unresolved'];
for (const bucket of BUCKETS) {
  if (!Array.isArray(data.membership?.[bucket])) problems.push(`membership.${bucket} must be an array`);
}

/* ---------------------------------------------------------------------------
 * Exactly one bucket, and every spot in one
 * ------------------------------------------------------------------------- */

const spotSlugs = spotsFile.spots.map((s) => s.slug);
const knownSlug = new Set(spotSlugs);
const bucketOf = new Map();

for (const bucket of BUCKETS) {
  for (const entry of data.membership?.[bucket] ?? []) {
    const slug = entry?.slug;
    if (typeof slug !== 'string' || !slug) {
      problems.push(`membership.${bucket}: an entry has no slug`);
      continue;
    }
    if (!knownSlug.has(slug)) {
      problems.push(`membership.${bucket}: ${slug} is not a slug in shared/spots.json`);
      continue;
    }
    if (bucketOf.has(slug)) {
      problems.push(`${slug} is in two buckets: ${bucketOf.get(slug)} and ${bucket}`);
      continue;
    }
    bucketOf.set(slug, bucket);
  }
}

for (const slug of spotSlugs) {
  if (!bucketOf.has(slug)) {
    problems.push(
      `${slug} is in no bucket. Membership is stated three ways so that no null carries two ` +
        'meanings, and a spot in none of them is a spot this zone cannot answer for at all.',
    );
  }
}

/* ---------------------------------------------------------------------------
 * Members
 * ------------------------------------------------------------------------- */

const METHODS = [
  'author_estimate',
  'lidar_hypsometry',
  'inat_revealed',
  'pressure_logger',
  'marine_topography',
  'published_threshold',
];

/** Methods that measure the bench with an instrument. floor-calibration.md section 7 clause 2. */
const INSTRUMENTED = new Set(['lidar_hypsometry', 'pressure_logger', 'marine_topography']);

/**
 * Methods barred from either side of a clause-1 agreement comparison.
 *
 * An `inat_revealed` entry is a CEILING derived from observed sighting rates --
 * an upper bound on how permissive the floor may be. Section 7: "never one side
 * of a clause-1 agreement comparison at any tolerance. An upper bound from
 * citizen-science inference and a measurement are not two estimates of one
 * quantity." Three members carry one today and all three would otherwise look
 * like half of a promotion.
 */
const NOT_A_PROMOTION_INPUT = new Set(['inat_revealed', 'author_estimate']);

const AGREEMENT_FT = 0.3;

for (const member of data.membership?.members ?? []) {
  const at = `members ${member.slug ?? '(no slug)'}`;

  if (typeof member.floor_ft !== 'number') {
    problems.push(`${at}: floor_ft must be a number; a member with no floor belongs in unresolved`);
  }
  if (member.floor_confidence !== 'low' && member.floor_confidence !== 'verified') {
    problems.push(`${at}: floor_confidence must be 'low' or 'verified', got ${JSON.stringify(member.floor_confidence)}`);
  }
  if (!Array.isArray(member.floor_evidence) || member.floor_evidence.length === 0) {
    problems.push(
      `${at}: floor_evidence must hold at least one entry. A floor with no ledger is an ` +
        'uncalibrated number wearing no warning, which is the state this file exists to end.',
    );
    continue;
  }

  for (const [i, e] of member.floor_evidence.entries()) {
    const entryAt = `${at} floor_evidence[${i}]`;
    if (!METHODS.includes(e.method)) {
      problems.push(`${entryAt}: method ${JSON.stringify(e.method)} is not one of ${METHODS.join(' | ')}`);
    }
    for (const key of ['source', 'source_date', 'run_date', 'note']) {
      if (typeof e[key] !== 'string' || !e[key]) problems.push(`${entryAt}: ${key} is required`);
    }
    if (e.value_ft !== null && typeof e.value_ft !== 'number') {
      problems.push(`${entryAt}: value_ft must be a number or null`);
    }
    // The repo's null-carries-a-reason rule, on this file's terms: a run that
    // produced nothing usable must be distinguishable from one never made.
    if (e.value_ft === null && (typeof e.note !== 'string' || e.note.length < 20)) {
      problems.push(
        `${entryAt}: value_ft is null with no note. A null value_ft with an empty note is a bug -- ` +
          "it makes 'has not run' indistinguishable from 'ran and produced nothing usable'.",
      );
    }
    if (e.datum_transform !== null && typeof e.datum_transform !== 'string') {
      problems.push(`${entryAt}: datum_transform must be a string or null`);
    }
    if (e.n !== null && typeof e.n !== 'number') problems.push(`${entryAt}: n must be a number or null`);
  }

  /*
   * The promotion rule, checked rather than trusted.
   *
   * Two entries from DIFFERENT methods agreeing within 0.3 ft, at least one of
   * them instrumented. Anything else stays `low`: a floor with three pieces of
   * weak evidence is still weak, and the enum has nowhere to put "better than an
   * author estimate but not surveyed".
   *
   * Section 7 also records that the rule is currently unsatisfiable by lidar
   * hypsometry -- VDatum's NAVD88 -> MLLW uncertainty at these spots is
   * +/-0.299-0.313 ft, which spends the whole 0.3 ft budget on the transform,
   * and at Cabrillo neither recommended product reproduces the surveyed bench at
   * all. That is not encoded here. This checks the rule as written; #65 revises
   * the tolerance, and this check follows it when it does.
   */
  if (member.floor_confidence === 'verified') {
    const usable = (member.floor_evidence ?? []).filter(
      (e) => typeof e.value_ft === 'number' && !NOT_A_PROMOTION_INPUT.has(e.method),
    );
    let promoted = false;
    for (const a of usable) {
      for (const b of usable) {
        if (a === b || a.method === b.method) continue;
        if (Math.abs(a.value_ft - b.value_ft) > AGREEMENT_FT) continue;
        if (!INSTRUMENTED.has(a.method) && !INSTRUMENTED.has(b.method)) continue;
        promoted = true;
      }
    }
    if (!promoted) {
      problems.push(
        `${at}: floor_confidence is 'verified' and the ledger does not support it. That takes two ` +
          `entries from different methods with a value_ft agreeing within ${AGREEMENT_FT} ft, at least ` +
          'one of them instrumented (lidar_hypsometry, pressure_logger, marine_topography), and ' +
          'neither of them an author_estimate or an inat_revealed ceiling. See ' +
          'tools/calibration/floor-calibration.md section 7.',
      );
    }
  }
}

/* ---------------------------------------------------------------------------
 * The two exclusion buckets
 * ------------------------------------------------------------------------- */

for (const bucket of ['not_in_zone', 'unresolved']) {
  for (const entry of data.membership?.[bucket] ?? []) {
    if (typeof entry.reason !== 'string' || entry.reason.length < 20) {
      problems.push(
        `membership.${bucket} ${entry.slug}: reason is required and is rendered verbatim to a ` +
          'reader. A bucket with no reason is the bare null this file exists to replace.',
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`shared/intertidal.json has ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/* ===========================================================================
 * Generate
 * ========================================================================= */

const union = (values) => (values.length ? values.map((v) => `'${v}'`).join(' | ') : 'never');

const members = data.membership.members;
const notInZone = data.membership.not_in_zone;
const unresolved = data.membership.unresolved;

const out = `// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/intertidal.json (version ${data.version}, generated ${data.generated})
// Generator: scripts/gen-intertidal-types.mjs
// Regen:     npm run gen:intertidal      Verify: npm run gen:intertidal:check
//
// Editing this file by hand puts the types out of step with the zone facts of
// record. Edit shared/intertidal.json and regenerate.
//
// This file is the shape of the zone FILE. The zone MODULE is
// core/zones/intertidal.ts, which is what an activity reads: it joins these
// facts to the spot inventory and answers membership questions. Nothing outside
// core/zones/ should need to import this directly.

import intertidalJson from './intertidal.json';

/** Slugs that are members of the intertidal zone: ${members.length} of ${spotSlugs.length}. */
export type IntertidalMemberSlug = ${union(members.map((m) => m.slug))};

/** Slugs stated NOT to have this zone, each with a reason: ${notInZone.length} of ${spotSlugs.length}. */
export type IntertidalNotInZoneSlug = ${union(notInZone.map((e) => e.slug))};

/** Slugs whose membership or facts are unmeasured: ${unresolved.length} of ${spotSlugs.length}. */
export type IntertidalUnresolvedSlug = ${union(unresolved.map((e) => e.slug))};

/**
 * How confident this repo is in a floor.
 *
 * \`verified\` is reachable only through the promotion rule in
 * tools/calibration/floor-calibration.md section 7 -- two entries from different
 * methods agreeing within 0.3 ft, at least one instrumented -- which
 * scripts/gen-intertidal-types.mjs checks against the ledger. No floor has been
 * promoted; all ${members.length} members are \`low\`.
 */
export type FloorConfidence = 'low' | 'verified';

/** The whole set of methods that may produce a ledger entry. Not free text. */
export type FloorMethod = ${union(METHODS)};

/**
 * One run of one method against one spot's floor.
 *
 * \`value_ft: null\` does NOT mean the method found nothing. It means the run
 * yielded no usable value, and \`note\` is required in that case so that "has not
 * run" can be told from "ran and produced nothing usable" -- the same rule
 * county_station_null_reason carries in the spot inventory.
 */
export interface FloorEvidence {
  method: FloorMethod;
  /** The artifact this came from, named precisely enough to find again. */
  source: string;
  /** When the underlying data was acquired, not when it was downloaded. */
  source_date: string;
  /** Feet above the datum in conventions. null where the run produced nothing usable. */
  value_ft: number | null;
  /** The vertical datum transformation applied, version pinned. null where none was. */
  datum_transform: string | null;
  n: number | null;
  run_date: string;
  /** What the run established. Required whenever value_ft is null. */
  note: string;
}

/**
 * A member: the spot has this zone, and here are its facts.
 *
 * \`floor_ft\` is the value IN FORCE, not the newest ledger entry. A human sets
 * it against the ledger, which is append-only, and the newest entry is not
 * automatically the answer -- three of these floors are ceilings from a
 * permissiveness rule and two of those are the conservative end of a bracket.
 */
export interface IntertidalMember {
  slug: IntertidalMemberSlug;
  floor_ft: number;
  floor_confidence: FloorConfidence;
  floor_evidence: FloorEvidence[];
}

/**
 * A spot in one of the two exclusion buckets, with the reason it is there.
 *
 * The reason is a string rather than an enum because it is RENDERED, verbatim,
 * and each one says something different about a different place. A code would
 * push the wording into a component, which is where two wordings of the same
 * caveat start drifting apart.
 */
export interface IntertidalExclusion<Slug extends string> {
  slug: Slug;
  reason: string;
}

interface IntertidalFile {
  version: string;
  generated: string;
  zone: string;
  corridor: string;
  conventions: {
    datum: string;
    floor_units: string;
    coordinate_source: string;
    height_reference: string;
  };
  membership: {
    members: IntertidalMember[];
    not_in_zone: IntertidalExclusion<IntertidalNotInZoneSlug>[];
    unresolved: IntertidalExclusion<IntertidalUnresolvedSlug>[];
  };
  unresolved: string[];
}

const FILE = intertidalJson as unknown as IntertidalFile;

export const INTERTIDAL_VERSION = '${data.version}';
export const INTERTIDAL_GENERATED = '${data.generated}';
export const INTERTIDAL_DATUM = '${data.conventions.datum}';
export const INTERTIDAL_FLOOR_UNITS = '${data.conventions.floor_units}';

export const INTERTIDAL_MEMBERS: readonly IntertidalMember[] = FILE.membership.members;
export const INTERTIDAL_NOT_IN_ZONE: readonly IntertidalExclusion<IntertidalNotInZoneSlug>[] =
  FILE.membership.not_in_zone;
export const INTERTIDAL_UNRESOLVED: readonly IntertidalExclusion<IntertidalUnresolvedSlug>[] =
  FILE.membership.unresolved;

/**
 * The file's own caveats channel, and a DIFFERENT thing from
 * INTERTIDAL_UNRESOLVED: this is prose about what the file does not cover, that
 * is the spots whose membership is unmeasured.
 */
export const INTERTIDAL_FILE_UNRESOLVED: readonly string[] = FILE.unresolved;
`;

/* ===========================================================================
 * --check
 *
 * LF-normalised, for the reason scripts/gen-spots-types.mjs sets out at length:
 * this compares generator output against a file git handed back, git is entitled
 * to rewrite line endings on the way, and a drift guard that cries wolf gets
 * ignored -- which costs more than the drift it was watching for.
 * ========================================================================= */

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

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error('shared/intertidal.generated.ts is missing. Run: npm run gen:intertidal');
    process.exit(1);
  }

  const diff = firstDifference(stripCr(current), stripCr(out));

  if (diff) {
    console.error(
      `shared/intertidal.generated.ts is stale relative to shared/intertidal.json ` +
        `(version ${data.version}, generated ${data.generated}).\n\n` +
        `  first difference at line ${diff.line}\n` +
        `    committed: ${diff.committed.slice(0, 160)}\n` +
        `    generated: ${diff.generated.slice(0, 160)}\n\n` +
        `Run: npm run gen:intertidal`,
    );
    process.exit(1);
  }

  if (current !== out) {
    console.warn(
      'shared/intertidal.generated.ts matches shared/intertidal.json, but its line endings ' +
        'differ from what this generator writes (it writes LF).\n' +
        'The types are current -- do NOT run gen:intertidal, which would rewrite the ' +
        'whole file. Run: git add --renormalize .',
    );
  }

  console.log(
    `shared/intertidal.generated.ts is current (${members.length} members, ` +
      `${notInZone.length} not_in_zone, ${unresolved.length} unresolved, version ${data.version}).`,
  );
  process.exit(0);
}

writeFileSync(OUT, out);
console.log(
  `Wrote shared/intertidal.generated.ts from intertidal.json ${data.version}: ` +
    `${members.length} members, ${notInZone.length} not_in_zone, ${unresolved.length} unresolved, ` +
    `${bucketOf.size} of ${spotSlugs.length} spots classified.`,
);
