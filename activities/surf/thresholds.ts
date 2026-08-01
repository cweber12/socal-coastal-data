/**
 * Surf's own thresholds: the tide band, the swell minimum, and the two per-spot
 * swell ceilings.
 *
 * Everything this module returns is an author estimate. #128 landed the two
 * overrides here because shared/thresholds.json was the wrong home for
 * per-activity judgements; #129 added the band and the minimum and built the
 * predicate that reads all four. See docs/adr/0012 for the provenance class and
 * docs/adr/0014 for why there is no measured surf fact to sit beside them.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of feet, asserted separately
 * ---------------------------------------------------------------------------
 *
 * `units` is wave height at a buoy. `tide_units` with `tide_datum` is tide
 * height above a vertical datum. They share a unit name and describe different
 * quantities, and the failure mode of conflating them is silent: a metric wave
 * file would veto everything over about a foot, and a band on the wrong datum
 * would shift every session by the offset between the two with nothing in the
 * output looking wrong.
 *
 * So both are checked, and checked independently. Reading one 'ft' and reusing
 * the answer for the other is the shortcut this file exists to refuse.
 */

import surfThresholds from './thresholds.json';
import type { SpotSlug } from '@/shared/spots.generated';
import type { SwellCeiling, ThresholdConfidence } from '@/core/thresholds';
import { DEFAULT_SWELL_CEILING_FT, DEFAULT_SWELL_CONFIDENCE } from '@/core/thresholds';

interface SurfThresholdsFile {
  version: string;
  generated: string;
  activity: string;
  units: string;
  tide_datum: string;
  tide_units: string;
  tide_band: {
    min_ft: number;
    max_ft: number;
    confidence: ThresholdConfidence;
    reason: string;
  };
  swell_minimum_ft: {
    ft: number;
    confidence: ThresholdConfidence;
    reason: string;
  };
  overrides: Record<
    string,
    { swell_ceiling_ft: number; confidence: ThresholdConfidence; reason: string }
  >;
  unresolved: string[];
}

const FILE = surfThresholds as unknown as SurfThresholdsFile;

if (FILE.units !== 'ft') {
  // Same guard core/thresholds.ts carries, for the same reason: the ceiling is
  // compared against a wave height in feet, and a metric file would veto
  // everything above about a foot without looking wrong anywhere.
  throw new Error(
    `activities/surf/thresholds.json declares units ${JSON.stringify(FILE.units)}; this module ` +
      'compares against feet and will not convert on an unrecognised unit.',
  );
}

if (FILE.tide_units !== 'ft') {
  throw new Error(
    `activities/surf/thresholds.json declares tide_units ${JSON.stringify(FILE.tide_units)}; the ` +
      'band is compared against CO-OPS predictions fetched in feet.',
  );
}

if (FILE.tide_datum !== 'MLLW') {
  /*
   * The same guard core/zones/intertidal.ts carries on the floor, and it matters
   * here for the same reason: the band is compared against predictions fetched
   * in MLLW, nothing in this stack converts between datums, and a band declared
   * on another datum would move every session by the offset between them
   * without a single number on the page looking wrong.
   */
  throw new Error(
    `activities/surf/thresholds.json declares tide_datum ${JSON.stringify(FILE.tide_datum)}; the ` +
      'band is compared against MLLW predictions and nothing in this stack converts between datums.',
  );
}

if (!(FILE.tide_band.min_ft < FILE.tide_band.max_ft)) {
  /*
   * An inverted or empty band is not a stricter band -- it is a band no tide can
   * ever be inside, which renders as "out of band" on every spot on every day
   * and reads exactly like a quiet week. Refused on load rather than discovered
   * as a page of identical verdicts.
   */
  throw new Error(
    `activities/surf/thresholds.json declares a tide band of [${FILE.tide_band.min_ft}, ` +
      `${FILE.tide_band.max_ft}] ft, which is empty. No tide can be inside it, so every day ` +
      'would read out-of-band and look like an ordinary flat week.',
  );
}

export const SURF_THRESHOLDS_VERSION = FILE.version;
export const SURF_UNRESOLVED: readonly string[] = FILE.unresolved;

/** Slugs carrying a surf-specific ceiling. Two, both uncalibrated author estimates. */
export const SURF_OVERRIDE_SLUGS: readonly string[] = Object.keys(FILE.overrides);

export interface TideBand {
  /** Tide height below which the spot is out of band. Strict. */
  minFt: number;
  /** Tide height above which the spot is out of band. Strict. */
  maxFt: number;
  confidence: ThresholdConfidence;
  reason: string;
}

/**
 * The tide band, corridor-wide.
 *
 * One band for all twenty-four surf-zone spots, which is the single largest
 * approximation on the surf page and is stated as such in the file's own
 * `unresolved` array. There is deliberately no per-spot override mechanism: a
 * second band for one spot would be a second author estimate with no more
 * evidence than the first, and the honest move is to leave the approximation
 * visible rather than to decorate it. #135 is the path.
 */
export const SURF_TIDE_BAND: TideBand = {
  minFt: FILE.tide_band.min_ft,
  maxFt: FILE.tide_band.max_ft,
  confidence: FILE.tide_band.confidence,
  reason: FILE.tide_band.reason,
};

export interface SwellMinimum {
  ft: number;
  confidence: ThresholdConfidence;
  reason: string;
}

/**
 * The swell below which there is nothing to ride.
 *
 * The counterpart to the ceiling and not its mirror. Over the ceiling is a
 * hazard; under this is an absence. They are separate states with separate
 * sentences precisely so a reader is never told "called off" about a lake.
 */
export const SURF_SWELL_MINIMUM: SwellMinimum = {
  ft: FILE.swell_minimum_ft.ft,
  confidence: FILE.swell_minimum_ft.confidence,
  reason: FILE.swell_minimum_ft.reason,
};

/**
 * This spot's swell ceiling for surf: its own override, or the corridor default.
 *
 * The default comes from `shared/thresholds.json` rather than being repeated
 * here. A second copy of 3.0 ft would be a second thing to keep in step, and
 * the corridor default is corridor-wide by definition -- it is what applies
 * where nothing has been said about a spot specifically.
 */
export function swellCeilingFor(slug: SpotSlug | string): SwellCeiling {
  const override = FILE.overrides[slug];
  if (override) {
    return {
      ceilingFt: override.swell_ceiling_ft,
      confidence: override.confidence,
      reason: override.reason,
      isDefault: false,
    };
  }
  return {
    ceilingFt: DEFAULT_SWELL_CEILING_FT,
    confidence: DEFAULT_SWELL_CONFIDENCE,
    reason: null,
    isDefault: true,
  };
}
