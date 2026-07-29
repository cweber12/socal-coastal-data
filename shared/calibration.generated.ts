// GENERATED FILE -- do not edit by hand.
//
// Source:    shared/calibration.json (version 1.0.0, pulled 2026-07-29)
// Generator: scripts/gen-calibration-types.mjs
// Regen:     npm run gen:calibration      Verify: npm run gen:calibration:check
//
// Editing this file by hand puts the types out of step with the calibration of
// record. Re-run the pipeline and regenerate.

import calibrationJson from './calibration.json';

/** Slugs the calibration ran against. Not every spot publishes a rate. */
export type CalibratedSlug = 'swamis' | 'cardiff-reef' | 'torrey-pines-beach' | 'la-jolla-shores' | 'la-jolla-cove' | 'windansea' | 'sunset-cliffs' | 'cabrillo-tidepools';

/** Bin edges, feet above MLLW at station 9410230. */
export const BIN_EDGES_FT: readonly number[] = [-2.5,-1,-0.5,0,0.5,1,3];

export const CALIBRATION_VERSION = '1.0.0';
export const TAXA_VERSION = '1.0.0';
export const CALIBRATION_PULLED_AT = '2026-07-29';
export const CALIBRATION_CONTENT_HASH = 'b541c2498b7819dce9ff88ce900db46a232021447b0f63abf287cdb62ac16d91';
export const CALIBRATION_DATUM = 'MLLW';
export const CALIBRATION_TIDE_STATION = '9410230';
export const CALIBRATION_RADIUS_M = 500;
export const CALIBRATION_CORPUS_FROM = '2016-01-01';

/** Visits a bin needs before any gate may read it. */
export const USABLE_BIN_MIN_VISITS = 15;

/**
 * One bin's observed record.
 *
 * `rate` is null exactly when `visits` is 0, which the generator validates. A
 * bin with visits always has a rate, and the rate is always `hits / visits` --
 * a count, not an estimate. `usable` is false below 15 visits; such a bin is
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
 * A spot's calibration, as a discriminated union on `published`.
 *
 * This is the whole point of generating a type for this file. There is no member
 * in which a rate stands without the reason it might be missing:
 *
 *   published: true   -> bins carry rates, null_reason is `null`
 *   published: false  -> null_reason is a `string`, and the bins are diagnostic
 *                        counts only, NOT a rate table to render
 *
 * A consumer that reads `spot.bins` without narrowing on `published` first does
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

/** Slugs that published a rate table. 3 of 8 on this corpus. */
export const PUBLISHED_SLUGS: readonly CalibratedSlug[] = ["swamis","sunset-cliffs","cabrillo-tidepools"];

export const CALIBRATION_QUERIES: readonly string[] = FILE.queries;
