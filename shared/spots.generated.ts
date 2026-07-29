// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/spots.json (version 1.3.0, generated 2026-07-29)
// Generator: scripts/gen-spots-types.mjs
// Regen:     npm run gen:types      Verify: npm run gen:types:check
//
// Editing this file by hand puts the types out of step with the inventory of
// record. Edit shared/spots.json and regenerate.

import spotsJson from './spots.json';

/** Every slug present in the inventory. Slugs are the stable primary key. */
export type SpotSlug = 'oceanside-harbor' | 'oceanside-pier' | 'buccaneer-beach' | 'tamarack-carlsbad' | 'ponto-south-carlsbad' | 'batiquitos-lagoon' | 'beacons-leucadia' | 'moonlight-encinitas' | 'swamis' | 'cardiff-reef' | 'san-elijo-lagoon' | 'del-mar-15th' | 'torrey-pines-beach' | 'blacks-beach' | 'la-jolla-shores' | 'la-jolla-cove' | 'windansea' | 'tourmaline' | 'mission-beach' | 'ocean-beach-pier' | 'sunset-cliffs' | 'cabrillo-tidepools' | 'coronado-central' | 'silver-strand' | 'imperial-beach-pier' | 'border-field';

/** Audience tags. These drive column visibility, not thresholds. */
export type Audience = 'bird' | 'dive' | 'sail' | 'surf' | 'swim' | 'tidepool';

/** NDBC WMO buoy ids known to the inventory, live or dead. */
export type BuoyId = '46224' | '46225' | '46232' | '46235' | '46254' | '46258' | '46266' | '46274';

/** NOAA CO-OPS tide station ids known to the inventory. */
export type TideStationId = '9410170' | '9410230';

/**
 * Slugs carrying a non-null tidepool_floor_ft, derived from the data rather
 * than hand-listed. These are the only spots the window grid can evaluate: a
 * null floor is unresolved, and the window predicate refuses to guess one.
 */
export type TidepoolSpotSlug = 'swamis' | 'cardiff-reef' | 'torrey-pines-beach' | 'la-jolla-shores' | 'la-jolla-cove' | 'windansea' | 'sunset-cliffs' | 'cabrillo-tidepools';

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
 * mpa and mpa_resolved are paired deliberately. `{ mpa: null, mpa_resolved:
 * false }` means UNKNOWN, not unprotected -- the spot sits inside the file's own
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
export const SPOTS_VERSION = '1.3.0';
export const SPOTS_GENERATED = '2026-07-29';

/** Display timezone for the whole corridor, read from the file's conventions. */
export const DISPLAY_TIME_ZONE = "America/Los_Angeles";

/** Tide datum and units, read from the file rather than assumed at each call site. */
export const TIDE_DATUM = "MLLW";
export const TIDE_UNITS = "ft";
export const WAVE_UNITS = "ft";

/**
 * Buoys the inventory marks dead. verify_coastal_apis.py treats these as
 * tripwires: if one flips to REVIVED, the spots carrying it as
 * wave.intended_primary need reassigning.
 */
export const DEAD_BUOY_IDS: readonly BuoyId[] = ['46235'];

/**
 * Null prototype, deliberately.
 *
 * This map is looked up by a URL segment, which is untrusted input. Built with
 * a bare Object.fromEntries it inherits Object.prototype, so `constructor`,
 * `toString`, `valueOf` and `__proto__` all answer with something truthy.
 * tidepoolSpotBySlug's guard is `tidepool_floor_ft !== null`, and `undefined
 * !== null` is true, so every one of those inherited values passed as an
 * evaluable spot: /spot/constructor got past notFound() and then threw on
 * `spot.wave.intended_primary`, serving a 500 where a 404 belongs.
 *
 * Object.create(null) has no such keys, so a miss is a miss.
 */
export const SPOT_BY_SLUG: Readonly<Record<SpotSlug, Spot>> = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(SPOTS.map((s) => [s.slug, s])),
  ) as Record<SpotSlug, Spot>,
);

/**
 * The window grid's scope. 8 of 26 spots carry a floor; the
 * other 18 are excluded because a null floor is unresolved, and the
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
