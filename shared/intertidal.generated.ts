// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/intertidal.json (version 1.1.1, generated 2026-08-01)
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

/** Slugs that are members of the intertidal zone: 8 of 26. */
export type IntertidalMemberSlug = 'swamis' | 'cardiff-reef' | 'torrey-pines-beach' | 'la-jolla-shores' | 'la-jolla-cove' | 'windansea' | 'sunset-cliffs' | 'cabrillo-tidepools';

/** Slugs stated NOT to have this zone, each with a reason: 4 of 26. */
export type IntertidalNotInZoneSlug = 'oceanside-harbor' | 'batiquitos-lagoon' | 'san-elijo-lagoon' | 'silver-strand';

/** Slugs whose membership or facts are unmeasured: 14 of 26. */
export type IntertidalUnresolvedSlug = 'oceanside-pier' | 'buccaneer-beach' | 'tamarack-carlsbad' | 'ponto-south-carlsbad' | 'beacons-leucadia' | 'moonlight-encinitas' | 'del-mar-15th' | 'blacks-beach' | 'tourmaline' | 'mission-beach' | 'ocean-beach-pier' | 'coronado-central' | 'imperial-beach-pier' | 'border-field';

/**
 * How confident this repo is in a floor.
 *
 * `verified` is reachable only through the promotion rule in
 * tools/calibration/floor-calibration.md section 7 -- two entries from different
 * methods agreeing within 0.3 ft, at least one instrumented -- which
 * scripts/gen-intertidal-types.mjs checks against the ledger. No floor has been
 * promoted; all 8 members are `low`.
 */
export type FloorConfidence = 'low' | 'verified';

/** The whole set of methods that may produce a ledger entry. Not free text. */
export type FloorMethod = 'author_estimate' | 'lidar_hypsometry' | 'inat_revealed' | 'pressure_logger' | 'marine_topography' | 'published_threshold';

/**
 * One run of one method against one spot's floor.
 *
 * `value_ft: null` does NOT mean the method found nothing. It means the run
 * yielded no usable value, and `note` is required in that case so that "has not
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
 * `floor_ft` is the value IN FORCE, not the newest ledger entry. A human sets
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

export const INTERTIDAL_VERSION = '1.1.1';
export const INTERTIDAL_GENERATED = '2026-08-01';
export const INTERTIDAL_DATUM = 'MLLW';
export const INTERTIDAL_FLOOR_UNITS = 'ft';

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
