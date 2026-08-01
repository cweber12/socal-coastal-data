// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/spots.json (version 3.0.0, generated 2026-08-01)
// Generator: scripts/gen-spots-types.mjs
// Regen:     npm run gen:types      Verify: npm run gen:types:check
//
// Editing this file by hand puts the types out of step with the inventory of
// record. Edit shared/spots.json and regenerate.

import spotsJson from './spots.json';

/** Every slug present in the inventory. Slugs are the stable primary key. */
export type SpotSlug = 'oceanside-harbor' | 'oceanside-pier' | 'buccaneer-beach' | 'tamarack-carlsbad' | 'ponto-south-carlsbad' | 'batiquitos-lagoon' | 'beacons-leucadia' | 'moonlight-encinitas' | 'swamis' | 'cardiff-reef' | 'san-elijo-lagoon' | 'del-mar-15th' | 'torrey-pines-beach' | 'blacks-beach' | 'la-jolla-shores' | 'la-jolla-cove' | 'windansea' | 'tourmaline' | 'mission-beach' | 'ocean-beach-pier' | 'sunset-cliffs' | 'cabrillo-tidepools' | 'coronado-central' | 'silver-strand' | 'imperial-beach-pier' | 'border-field';

/** NDBC WMO buoy ids known to the inventory, live or dead. */
export type BuoyId = '46224' | '46225' | '46232' | '46235' | '46254' | '46258' | '46266' | '46274';

/** NOAA CO-OPS tide station ids known to the inventory. */
export type TideStationId = '9410170' | '9410230';

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
 * `county_station_scope` is on both arms rather than being a third one. It is
 * the join's INPUT -- which spots this repo asked about -- and an in-scope spot
 * whose station is genuinely unresolved is a legitimate state that no spot is in
 * today. Modelling that arm now would be a shape with no occupant, which this
 * repo adds when the case exists and not in anticipation of it. The generator
 * enforces the half that is decidable: scope `out` and a station cannot coexist.
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
       * Which kind of null this is. `out` means the join never asked -- the null
       * is deliberate. `in` would mean it asked and got nothing, which is a gap.
       */
      county_station_scope: 'in' | 'out';
      /** Required whenever the station is null. States out-of-scope vs genuinely unresolved. */
      county_station_null_reason: string;
    };

/**
 * The spots the county_station join covers, derived from the file so a re-run
 * scopes itself the way the recorded one did.
 *
 * 23 of 26 today. This is the machine-readable remains of a
 * sentence that used to read "ONLY for spots tagged swim, surf, dive or
 * tidepool" against an `audiences` field 3.0.0 deleted -- see
 * docs/adr/0011-a-join-carries-its-own-scope.md.
 */
export const COUNTY_STATION_IN_SCOPE: readonly SpotSlug[] = [
  'oceanside-harbor',
  'oceanside-pier',
  'buccaneer-beach',
  'tamarack-carlsbad',
  'ponto-south-carlsbad',
  'beacons-leucadia',
  'moonlight-encinitas',
  'swamis',
  'cardiff-reef',
  'del-mar-15th',
  'torrey-pines-beach',
  'blacks-beach',
  'la-jolla-shores',
  'la-jolla-cove',
  'windansea',
  'tourmaline',
  'mission-beach',
  'ocean-beach-pier',
  'sunset-cliffs',
  'cabrillo-tidepools',
  'coronado-central',
  'silver-strand',
  'imperial-beach-pier',
];

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
export const SPOTS_VERSION = '3.0.0';
export const SPOTS_GENERATED = '2026-08-01';

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
 * `toString`, `valueOf` and `__proto__` all answer with something truthy. The
 * slug resolver's guard was `tidepool_floor_ft !== null`, and `undefined !==
 * null` is true, so every one of those inherited values passed as an evaluable
 * spot: /spot/constructor got past notFound() and then threw on
 * `spot.wave.intended_primary`, serving a 500 where a 404 belongs. The guard is
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

