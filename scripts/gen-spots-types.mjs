#!/usr/bin/env node
/*
 * Generates shared/spots.generated.ts from shared/spots.json.
 *
 * Why generate rather than hand-write the types: spots.json is the inventory of
 * record and its fields carry rules that a hand-written interface silently
 * drifts away from. Two in particular:
 *
 *   - A null county_station is REQUIRED to carry county_station_null_reason.
 *     The generated type models that as a discriminated union so a consumer
 *     that reads the station without checking the reason does not typecheck.
 *
 *   - mpa: null is not "unprotected". It means unresolved unless mpa_resolved
 *     is true. The generated type pairs them so they cannot be read apart.
 *
 * It also derives the slug, audience, buoy and station unions from the data, so
 * adding a spot to the JSON is the only edit needed, and derives the grid's
 * tidepool scope from which spots actually carry a floor rather than from a
 * hand-maintained list that can fall out of step.
 *
 *   node scripts/gen-spots-types.mjs           # write
 *   node scripts/gen-spots-types.mjs --check   # exit 1 if the file is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'shared', 'spots.json');
const OUT = join(ROOT, 'shared', 'spots.generated.ts');

const raw = readFileSync(SRC, 'utf8');
const data = JSON.parse(raw);

/* ---------------------------------------------------------------------------
 * Validate the source before generating from it. A generator that emits types
 * for a file it has not checked just moves the failure downstream, where it
 * shows up as a plausible-looking wrong number instead of a build error.
 * ------------------------------------------------------------------------- */

const problems = [];
const seenSlugs = new Set();

for (const [i, s] of data.spots.entries()) {
  const at = `spots[${i}] ${s.slug ?? '(no slug)'}`;

  if (typeof s.slug !== 'string' || !s.slug) problems.push(`${at}: missing slug`);
  if (seenSlugs.has(s.slug)) problems.push(`${at}: duplicate slug`);
  seenSlugs.add(s.slug);

  if (typeof s.lat !== 'number' || typeof s.lon !== 'number') {
    problems.push(`${at}: lat/lon must both be numbers`);
  }
  if (s.lon > 0) problems.push(`${at}: lon ${s.lon} is positive; this corridor is west`);

  // The repo rule: a null county_station without a reason is a bug, because a
  // bare null is indistinguishable from an unresolved join and must never
  // render as a pass.
  if (s.county_station === null && !s.county_station_null_reason) {
    problems.push(`${at}: county_station is null with no county_station_null_reason`);
  }
  if (s.county_station !== null && s.county_station_null_reason) {
    problems.push(`${at}: has county_station_null_reason while county_station is set`);
  }

  if (typeof s.mpa_resolved !== 'boolean') {
    problems.push(`${at}: mpa_resolved must be a boolean, got ${JSON.stringify(s.mpa_resolved)}`);
  }

  // A floor without a confidence label is an uncalibrated number wearing no
  // warning. The grid renders these; they have to stay labelled.
  const hasFloor = s.tidepool_floor_ft !== null;
  const hasConfidence = s.tidepool_floor_confidence !== null;
  if (hasFloor !== hasConfidence) {
    problems.push(`${at}: tidepool_floor_ft and tidepool_floor_confidence must be set or null together`);
  }
  if (hasFloor && typeof s.tidepool_floor_ft !== 'number') {
    problems.push(`${at}: tidepool_floor_ft must be a number when set`);
  }

  if (!Array.isArray(s.audiences) || s.audiences.length === 0) {
    problems.push(`${at}: audiences must be a non-empty array`);
  }
  if (typeof s.tide_station !== 'string' || !data.tide_stations[s.tide_station]) {
    problems.push(`${at}: tide_station ${JSON.stringify(s.tide_station)} is not in tide_stations`);
  }

  for (const key of ['primary', 'fallback', 'intended_primary']) {
    const id = s.wave?.[key];
    if (id != null && !data.buoys[id]) {
      problems.push(`${at}: wave.${key} ${id} is not in buoys`);
    }
  }
}

if (problems.length) {
  console.error('shared/spots.json failed validation:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

/* ------------------------------------------------------------------------- */

const uniqSorted = (xs) => [...new Set(xs)].sort();
const union = (xs) => (xs.length ? xs.map((x) => `'${x}'`).join(' | ') : 'never');

const slugs = data.spots.map((s) => s.slug);
const audiences = uniqSorted(data.spots.flatMap((s) => s.audiences));
const buoyIds = uniqSorted(Object.keys(data.buoys));
const stationIds = uniqSorted(Object.keys(data.tide_stations));
const tidepoolSlugs = data.spots.filter((s) => s.tidepool_floor_ft !== null).map((s) => s.slug);
const deadBuoys = buoyIds.filter((id) => data.buoys[id].status !== 'live');

const out = `// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/spots.json (version ${data.version}, generated ${data.generated})
// Generator: scripts/gen-spots-types.mjs
// Regen:     npm run gen:types      Verify: npm run gen:types:check
//
// Editing this file by hand puts the types out of step with the inventory of
// record. Edit shared/spots.json and regenerate.

import spotsJson from './spots.json';

/** Every slug present in the inventory. Slugs are the stable primary key. */
export type SpotSlug = ${union(slugs)};

/** Audience tags. These drive column visibility, not thresholds. */
export type Audience = ${union(audiences)};

/** NDBC WMO buoy ids known to the inventory, live or dead. */
export type BuoyId = ${union(buoyIds)};

/** NOAA CO-OPS tide station ids known to the inventory. */
export type TideStationId = ${union(stationIds)};

/**
 * Slugs carrying a non-null tidepool_floor_ft, derived from the data rather
 * than hand-listed. These are the only spots the window grid can evaluate: a
 * null floor is unresolved, and the window predicate refuses to guess one.
 */
export type TidepoolSpotSlug = ${union(tidepoolSlugs)};

export type FloorConfidence = 'low' | 'verified';

export interface WaveBinding {
  /** Buoy actually queried today. null for non-wave sites (lagoons, estuaries). */
  primary: BuoyId | null;
  /** Used when primary is not delivering. May be geographically distant; the UI must disclose the substitution. */
  fallback: BuoyId | null;
  /** Buoy that SHOULD serve this spot but is currently dead. Reassign on REVIVED. */
  intended_primary?: BuoyId;
}

/**
 * county_station as a discriminated union, so the repo's rule is enforced by
 * the compiler: a null station always carries the reason it is null, and a
 * present station always carries its distance and suspect flag. A bare null can
 * never be read as a pass because there is no shape where it stands alone.
 */
export type CountyStationBinding =
  | {
      county_station: string;
      county_station_distance_m: number;
      /** true past 1000 m: the station may sit on a different beach cell carrying different water. */
      county_station_suspect: boolean;
      county_station_null_reason?: undefined;
    }
  | {
      county_station: null;
      county_station_distance_m: null;
      county_station_suspect: null;
      /** Required whenever the station is null. States out-of-scope vs genuinely unresolved. */
      county_station_null_reason: string;
    };

/**
 * mpa and mpa_resolved are paired deliberately. \`{ mpa: null, mpa_resolved:
 * false }\` means UNKNOWN, not unprotected -- the spot sits inside the file's own
 * ~100 m coordinate error bar of a boundary, so the in/out call is not
 * trustworthy in either direction. Legally load-bearing for tidepooling.
 */
export interface MpaBinding {
  mpa: string | null;
  mpa_resolved: boolean;
}

export type Spot = {
  slug: SpotSlug;
  name: string;
  lat: number;
  lon: number;
  wave: WaveBinding;
  tide_station: TideStationId;
  audiences: Audience[];
  tidepool_floor_ft: number | null;
  tidepool_floor_confidence: FloorConfidence | null;
  notes: string;
} & CountyStationBinding &
  MpaBinding;

/** A Spot narrowed to those the window grid can evaluate. */
export type TidepoolSpot = Spot & {
  slug: TidepoolSpotSlug;
  tidepool_floor_ft: number;
  tidepool_floor_confidence: FloorConfidence;
};

export interface Buoy {
  name: string;
  cdip: string;
  status: 'live' | 'dead';
  dead_since?: string;
  note?: string;
}

export interface TideStation {
  name: string;
  role: string;
}

export interface SpotsFile {
  version: string;
  generated: string;
  corridor: string;
  conventions: {
    datum: string;
    tide_units: string;
    wave_units: string;
    coordinate_system: string;
    coordinate_precision: string;
    timezone_display: string;
    timezone_storage: string;
  };
  buoys: Record<BuoyId, Buoy>;
  tide_stations: Record<TideStationId, TideStation>;
  spots: Spot[];
  unresolved: string[];
}

export const SPOTS_FILE = spotsJson as unknown as SpotsFile;

export const SPOTS: readonly Spot[] = SPOTS_FILE.spots;
export const BUOYS = SPOTS_FILE.buoys;
export const TIDE_STATIONS = SPOTS_FILE.tide_stations;

/** Inventory version, surfaced in the UI so a stale deploy is visible. */
export const SPOTS_VERSION = '${data.version}';
export const SPOTS_GENERATED = '${data.generated}';

/** Display timezone for the whole corridor, read from the file's conventions. */
export const DISPLAY_TIME_ZONE = ${JSON.stringify(data.conventions.timezone_display)};

/** Tide datum and units, read from the file rather than assumed at each call site. */
export const TIDE_DATUM = ${JSON.stringify(data.conventions.datum)};
export const TIDE_UNITS = ${JSON.stringify(data.conventions.tide_units)};
export const WAVE_UNITS = ${JSON.stringify(data.conventions.wave_units)};

/**
 * Buoys the inventory marks dead. verify_coastal_apis.py treats these as
 * tripwires: if one flips to REVIVED, the spots carrying it as
 * wave.intended_primary need reassigning.
 */
export const DEAD_BUOY_IDS: readonly BuoyId[] = [${deadBuoys.map((b) => `'${b}'`).join(', ')}];

export const SPOT_BY_SLUG: Readonly<Record<SpotSlug, Spot>> = Object.freeze(
  Object.fromEntries(SPOTS.map((s) => [s.slug, s])) as Record<SpotSlug, Spot>,
);

/**
 * The window grid's scope. ${tidepoolSlugs.length} of ${data.spots.length} spots carry a floor; the
 * other ${data.spots.length - tidepoolSlugs.length} are excluded because a null floor is unresolved, and the
 * page discloses the exclusion rather than quietly omitting them.
 */
export const TIDEPOOL_SPOTS: readonly TidepoolSpot[] = SPOTS.filter(
  (s): s is TidepoolSpot => s.tidepool_floor_ft !== null && s.tidepool_floor_confidence !== null,
);

/** Spots with no floor, kept addressable so the UI can name what it left out. */
export const SPOTS_WITHOUT_FLOOR: readonly Spot[] = SPOTS.filter(
  (s) => s.tidepool_floor_ft === null,
);

export function isTidepoolSpot(spot: Spot): spot is TidepoolSpot {
  return spot.tidepool_floor_ft !== null && spot.tidepool_floor_confidence !== null;
}
`;

/*
 * The comparison is on LF-NORMALISED content, not raw bytes.
 *
 * This check compares generator output against a file git handed back, and git
 * is entitled to rewrite line endings on the way. It did: with core.autocrlf=true
 * and no .gitattributes, every checkout produced CRLF while this generator writes
 * LF, so a raw byte comparison called the file stale on every run -- and the
 * "fix" it prescribed rewrote all 6708 bytes and produced a whole-file diff.
 *
 * .gitattributes now pins eol=lf so that should not recur, but a contributor can
 * always clone with different settings, and a drift guard that cries wolf gets
 * ignored, which costs more than the drift it was watching for. Line endings are
 * not what this check is about: whether the TYPES match the inventory is. So a
 * pure line-ending difference reports as a warning against a clean exit, naming
 * the actual remedy, which is `git add --renormalize .` and never `gen:types`.
 */
const stripCr = (s) => s.replace(/\r\n/g, '\n');

/** Where two texts first differ, as a line number and both sides of it. */
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
    console.error('shared/spots.generated.ts is missing. Run: npm run gen:types');
    process.exit(1);
  }

  const diff = firstDifference(stripCr(current), stripCr(out));

  if (diff) {
    console.error(
      `shared/spots.generated.ts is stale relative to shared/spots.json ` +
        `(version ${data.version}, generated ${data.generated}).\n\n` +
        `  first difference at line ${diff.line}\n` +
        `    committed: ${diff.committed.slice(0, 160)}\n` +
        `    generated: ${diff.generated.slice(0, 160)}\n\n` +
        `Run: npm run gen:types`,
    );
    process.exit(1);
  }

  if (current !== out) {
    console.warn(
      'shared/spots.generated.ts matches shared/spots.json, but its line endings ' +
        'differ from what this generator writes (it writes LF).\n' +
        'The types are current -- do NOT run gen:types, which would rewrite the ' +
        'whole file. Run: git add --renormalize .',
    );
  }

  console.log(`shared/spots.generated.ts is current (${data.spots.length} spots, version ${data.version}).`);
  process.exit(0);
}

writeFileSync(OUT, out);
console.log(
  `Wrote shared/spots.generated.ts from spots.json ${data.version}: ` +
    `${data.spots.length} spots, ${tidepoolSlugs.length} with a floor, ` +
    `${buoyIds.length} buoys (${deadBuoys.length} dead), ${stationIds.length} tide stations.`,
);
