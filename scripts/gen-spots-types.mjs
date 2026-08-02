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
 *   - mpa, mpa_type and ccr_section are one join result in three fields. The
 *     generated type makes them null together or set together, so a renderer
 *     that has a named area always has the designation that says what may be
 *     taken there, and cannot fall back to assuming.
 *
 * It also derives the slug, audience, buoy and station unions from the data, so
 * adding a spot to the JSON is the only edit needed.
 *
 * What is NOT here since spots.json 2.0.0: the tidepool floor, its confidence
 * and its evidence ledgers. Those are measured zone facts, they live in
 * shared/intertidal.json, and scripts/gen-intertidal-types.mjs generates their
 * types and derives zone membership from them. This file is bindings and joins.
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

/*
 * The designations the corridor's layer publishes, read from the file rather
 * than written here. tools/mpa/rejoin.py asserts this set against the live
 * service, so it is a measured property of ds582 and not a guess about it.
 */
const mpaTypes = data.joins?.mpa?.types_published;
if (!Array.isArray(mpaTypes) || mpaTypes.length === 0) {
  console.error(
    'shared/spots.json: joins.mpa.types_published is missing or empty. It is the domain of ' +
      'mpa_type, it is emitted as a union, and a renderer branches on it -- so generating ' +
      'types without it would produce a designation nothing has been told how to write.',
  );
  process.exit(1);
}

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

  /*
   * mpa, mpa_type and ccr_section are one join result. They are null together
   * or set together, and nothing in between is a state the join can produce.
   *
   * The pairing is the point rather than tidiness: mpa_type is what decides
   * whether take is permitted, so a named area carrying no designation leaves a
   * renderer with a legally load-bearing field and nothing behind it -- which is
   * exactly how spot-protection.tsx came to call every resolved area a reserve.
   */
  const mpaTriple = [s.mpa, s.mpa_type, s.ccr_section];
  const nulls = mpaTriple.filter((v) => v === null).length;
  if (nulls !== 0 && nulls !== 3) {
    problems.push(
      `${at}: mpa/mpa_type/ccr_section are ${JSON.stringify(mpaTriple)}. One join result in ` +
        'three fields: null together, or set together.',
    );
  }
  if (s.mpa !== null) {
    if (!mpaTypes.includes(s.mpa_type)) {
      problems.push(
        `${at}: mpa_type ${JSON.stringify(s.mpa_type)} is not one of ` +
          `${mpaTypes.map((t) => JSON.stringify(t)).join(', ')}. That set is ` +
          'joins.mpa.types_published, which tools/mpa/rejoin.py checks against the live layer.',
      );
    }
    if (!Number.isInteger(s.ccr_section)) {
      problems.push(
        `${at}: ccr_section must be the integer § 632(b) subsection, got ` +
          `${JSON.stringify(s.ccr_section)}`,
      );
    }
  }

  // A floor that came back here would be a second copy of a value
  // shared/intertidal.json is the record of, and nothing would keep the two in
  // step. The pair-and-type checks that used to run on it are in
  // scripts/gen-intertidal-types.mjs, against the file that holds it now.
  for (const key of ['tidepool_floor_ft', 'tidepool_floor_confidence', 'floor_evidence']) {
    if (key in s) {
      problems.push(
        `${at}: carries ${key}, which moved to shared/intertidal.json in 2.0.0. This file is ` +
          'bindings and joins; a measured zone fact does not belong in it.',
      );
    }
  }

  /*
   * The join's scope, required on every spot.
   *
   * This is the whole reason `audiences` could be deleted without the
   * county_station join becoming unrepeatable: the scope used to be the
   * sentence "ONLY for spots tagged swim, surf, dive or tidepool", evaluated
   * against a field that no longer exists. Requiring it here is what stops a
   * spot added later from being silently un-scoped -- which would not fail
   * anywhere else, and would quietly shrink a join nobody re-reads.
   */
  if (s.county_station_scope !== 'in' && s.county_station_scope !== 'out') {
    problems.push(
      `${at}: county_station_scope must be 'in' or 'out', got ` +
        `${JSON.stringify(s.county_station_scope)}. A spot with no scope is one the ` +
        'county_station join cannot be re-run over.',
    );
  }
  // Out of scope means the join did not ask, so there is nothing for it to have
  // answered. A station on an out-of-scope spot is a value with no join behind
  // it, which is the hand-populated result this file forbids.
  if (s.county_station_scope === 'out' && s.county_station !== null) {
    problems.push(`${at}: out of the join's scope, but carries county_station ${s.county_station}`);
  }
  if ('audiences' in s) {
    problems.push(
      `${at}: carries audiences, which 3.0.0 deleted. Zone membership is in ` +
        "shared/intertidal.json, and the county_station join's scope is county_station_scope.",
    );
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
const buoyIds = uniqSorted(Object.keys(data.buoys));
const stationIds = uniqSorted(Object.keys(data.tide_stations));
const inScope = data.spots.filter((s) => s.county_station_scope === 'in').map((s) => s.slug);
const inScopeList = inScope.map((s) => `  '${s}',`).join('\n');
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

/** NDBC WMO buoy ids known to the inventory, live or dead. */
export type BuoyId = ${union(buoyIds)};

/** NOAA CO-OPS tide station ids known to the inventory. */
export type TideStationId = ${union(stationIds)};

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
 *
 * \`county_station_scope\` is on both arms rather than being a third one. It is
 * the join's INPUT -- which spots this repo asked about -- and an in-scope spot
 * whose station is genuinely unresolved is a legitimate state that no spot is in
 * today. Modelling that arm now would be a shape with no occupant, which this
 * repo adds when the case exists and not in anticipation of it. The generator
 * enforces the half that is decidable: scope \`out\` and a station cannot coexist.
 */
export type CountyStationBinding =
  | {
      county_station: string;
      county_station_distance_m: number;
      /** true past 1000 m: the station may sit on a different beach cell carrying different water. */
      county_station_suspect: boolean;
      county_station_scope: 'in';
      county_station_null_reason?: undefined;
    }
  | {
      county_station: null;
      county_station_distance_m: null;
      county_station_suspect: null;
      /**
       * Which kind of null this is. \`out\` means the join never asked -- the null
       * is deliberate. \`in\` would mean it asked and got nothing, which is a gap.
       */
      county_station_scope: 'in' | 'out';
      /** Required whenever the station is null. States out-of-scope vs genuinely unresolved. */
      county_station_null_reason: string;
    };

/**
 * The spots the county_station join covers, derived from the file so a re-run
 * scopes itself the way the recorded one did.
 *
 * ${inScope.length} of ${data.spots.length} today. This is the machine-readable remains of a
 * sentence that used to read "ONLY for spots tagged swim, surf, dive or
 * tidepool" against an \`audiences\` field 3.0.0 deleted -- see
 * docs/adr/0011-a-join-carries-its-own-scope.md.
 */
export const COUNTY_STATION_IN_SCOPE: readonly SpotSlug[] = [
${inScopeList}
];

/**
 * The designations CDFW publishes for this corridor, from
 * joins.mpa.types_published rather than written here.
 *
 * Three values, and the third is the one that catches a careless renderer: an
 * \`SMCA (No-Take)\` prohibits take the way a reserve does while not being one.
 * Splitting only reserve-from-not, or only take-from-no-take, gets it wrong.
 * The corridor holds ${data.joins.mpa.corridor_areas} areas across these ${mpaTypes.length} designations.
 */
export type MpaType = ${union(mpaTypes)};

/** The same set at runtime, for exhaustiveness checks and tests. */
export const MPA_TYPES: readonly MpaType[] = [${mpaTypes.map((t) => `'${t}'`).join(', ')}];

/**
 * mpa, mpa_type, ccr_section and mpa_resolved are paired deliberately.
 *
 * \`{ mpa: null, mpa_resolved: false }\` means UNKNOWN, not unprotected -- the spot
 * sits inside the file's own ~100 m coordinate error bar of a boundary, so the
 * in/out call is not trustworthy in either direction.
 *
 * The union also makes \`mpa_type\` non-null whenever \`mpa\` is, so a consumer that
 * has an area name always has the designation deciding what may be taken there.
 * Reading the type off the end of the name would compile and would be wrong for
 * the same reason hand-populating any join result is.
 */
export type MpaBinding =
  | {
      mpa: string;
      /** What may be taken: SMR and SMCA (No-Take) prohibit take, SMCA permits specified take. */
      mpa_type: MpaType;
      /** 14 CCR § 632(b) subsection. The join key back to ds582, and what a warden cites. */
      ccr_section: number;
      mpa_resolved: boolean;
    }
  | {
      mpa: null;
      mpa_type: null;
      ccr_section: null;
      mpa_resolved: boolean;
    };

/**
 * Where the mpa join's polygons came from, and when.
 *
 * \`content_date\` and \`layer_last_edit_date\` are five years apart and neither on
 * its own is the layer's age -- see the file's \`joins.mpa.dates\`. Carried in the
 * types so a disclosure can render the disclaimer and the vintage from the
 * record rather than from a string in a component.
 */
export interface MpaJoinRecord {
  layer: string;
  publisher: string;
  service_url: string;
  method: string;
  attributes_read: readonly string[];
  /** When this repo last ran the join. */
  retrieved: string;
  /** What the layer says its data are, as opposed to when the service was touched. */
  content_date: string;
  /** editingInfo.lastEditDate: the in-band signal that the polygons were re-issued. */
  layer_last_edit_date: string;
  service_version: number;
  service_item_id: string;
  types_published: readonly MpaType[];
  corridor_areas: number;
  /** CDFW's own words. Present so a renderer quotes rather than paraphrases it. */
  disclaimer: string;
  dates: string;
  rerun: string;
}

/**
 * A spot: where it is, and what it is bound to. No zone facts.
 *
 * The tidepool floor was a field here up to 1.4.0. It is a measured zone fact,
 * it lives in shared/intertidal.json, and core/zones/intertidal.ts is what joins
 * it back to a Spot -- see docs/adr/0002-measured-zone-facts-are-a-third-provenance-class.md.
 */
export type Spot = {
  slug: SpotSlug;
  name: string;
  lat: number;
  lon: number;
  wave: WaveBinding;
  tide_station: TideStationId;
  notes: string;
} & CountyStationBinding &
  MpaBinding;

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
  /**
   * Upstream provenance per join. Only \`mpa\` is recorded today; county_station's
   * lives in tools/county-station/rejoin.py's pinned constants, and the
   * asymmetry is deliberate -- see the file's \`_schema.joins\`.
   */
  joins: { mpa: MpaJoinRecord };
  buoys: Record<BuoyId, Buoy>;
  tide_stations: Record<TideStationId, TideStation>;
  spots: Spot[];
  unresolved: string[];
}

export const SPOTS_FILE = spotsJson as unknown as SpotsFile;

export const SPOTS: readonly Spot[] = SPOTS_FILE.spots;
export const BUOYS = SPOTS_FILE.buoys;
export const TIDE_STATIONS = SPOTS_FILE.tide_stations;

/**
 * The ds582 pull behind every \`mpa\` value: service, dates, version, disclaimer.
 *
 * Exported so a disclosure quotes CDFW's own wording and states the layer's real
 * age from the record, rather than carrying either as a string in a component
 * where it would drift from the join it describes.
 */
export const MPA_JOIN = SPOTS_FILE.joins.mpa;

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

/**
 * Null prototype, deliberately.
 *
 * This map is looked up by a URL segment, which is untrusted input. Built with
 * a bare Object.fromEntries it inherits Object.prototype, so \`constructor\`,
 * \`toString\`, \`valueOf\` and \`__proto__\` all answer with something truthy. The
 * slug resolver's guard was \`tidepool_floor_ft !== null\`, and \`undefined !==
 * null\` is true, so every one of those inherited values passed as an evaluable
 * spot: /spot/constructor got past notFound() and then threw on
 * \`spot.wave.intended_primary\`, serving a 500 where a 404 belongs. The guard is
 * a membership lookup in core/zones/intertidal.ts now, and it is exactly as
 * dependent on a miss being a miss.
 *
 * Object.create(null) has no such keys, so a miss is a miss.
 */
export const SPOT_BY_SLUG: Readonly<Record<SpotSlug, Spot>> = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(SPOTS.map((s) => [s.slug, s])),
  ) as Record<SpotSlug, Spot>,
);

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
    `${data.spots.length} spots, ${buoyIds.length} buoys (${deadBuoys.length} dead), ` +
    `${stationIds.length} tide stations.`,
);
