/**
 * The read side of the calibration, mirroring lib/thresholds.ts.
 *
 * Pure. Asserts its units and datum on load, because every number it hands out
 * is a height in feet above MLLW at station 9410230 and nothing in the file
 * itself would stop a metric or a differently-datumed one being read as if it
 * were the same.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 * ---------------------------------------------------------------------------
 *
 * It is a COUNT. "Of 383 recorded visits to Cabrillo on days whose low was
 * between -2.5 and -1.0 ft, 68% logged one of these seven species." That is a
 * checkable statement about a record, and it is the whole claim.
 *
 * It is NOT a model output, not a probability, not an ecological assertion and
 * not a threshold. #30 evaluated fitting a logistic and reporting its 50%
 * crossing, and rejected it: the crossing is intercept-over-slope and inherits
 * both uncertainties amplified by 1/slope, which turned Cabrillo's "days per
 * year with a daylight window" into a range from 36 to 184. A 5-6x swing in how
 * often you can go is not publishable, so the bin table is published instead.
 *
 * ---------------------------------------------------------------------------
 * Refusals are the common case
 * ---------------------------------------------------------------------------
 *
 * Five of the eight spots refuse on the current corpus, each for a stated
 * reason. `calibrationFor` returns the discriminated union unchanged rather than
 * flattening it, so a caller cannot reach a rate without having narrowed on
 * `published` first. There is deliberately no "best effort" accessor and no
 * corridor fallback -- #30 rejected pooling on evidence, and a fallback rate on
 * a refused spot is exactly the null-rendering-as-a-pass failure spots.json
 * warns about.
 */

import calibrationJson from '@/shared/calibration.json';
import {
  BIN_EDGES_FT,
  CALIBRATION,
  CALIBRATION_BY_SLUG,
  CALIBRATION_CONTENT_HASH,
  CALIBRATION_CORPUS_FROM,
  CALIBRATION_DATUM,
  CALIBRATION_PULLED_AT,
  CALIBRATION_RADIUS_M,
  CALIBRATION_TIDE_STATION,
  CALIBRATION_VERSION,
  PUBLISHED_SLUGS,
  TAXA_VERSION,
  USABLE_BIN_MIN_VISITS,
  type CalibrationBin,
  type CalibratedSlug,
  type SpotCalibration,
} from '@/shared/calibration.generated';
import type { SpotSlug } from '@/shared/spots.generated';

const FILE = calibrationJson as unknown as { datum: string; tide_station: string };

if (FILE.datum !== 'MLLW') {
  // Bin edges are feet above the datum, and the window predicate compares a
  // predicted height against the intertidal floor on the same one. Another datum
  // would shift every bin by the offset between them, silently.
  throw new Error(
    `shared/calibration.json declares datum ${JSON.stringify(FILE.datum)}; this module and ` +
      'lib/windows.ts both work in MLLW feet and will not convert on an unrecognised datum.',
  );
}

if (FILE.tide_station !== '9410230') {
  /*
   * Every rate is expressed in 9410230 predicted feet -- the same coordinate
   * system lib/windows.ts consumes -- so local datum and range error cancels on
   * use. That cancellation is the reason all eight spots sharing one station is
   * a feature rather than a defect to correct. Adding subordinate-station
   * offsets would silently invalidate the calibration, and so would reading a
   * file built against a different station.
   */
  throw new Error(
    `shared/calibration.json was built against station ${JSON.stringify(FILE.tide_station)}, ` +
      'not 9410230. Every rate is in that station\'s predicted feet and is void against another.',
  );
}

export {
  BIN_EDGES_FT,
  CALIBRATION_CONTENT_HASH,
  CALIBRATION_CORPUS_FROM,
  CALIBRATION_DATUM,
  CALIBRATION_PULLED_AT,
  CALIBRATION_RADIUS_M,
  CALIBRATION_TIDE_STATION,
  CALIBRATION_VERSION,
  PUBLISHED_SLUGS,
  TAXA_VERSION,
  USABLE_BIN_MIN_VISITS,
};
export type { CalibrationBin, CalibratedSlug, SpotCalibration };

/**
 * A spot's calibration, or null when the pipeline never ran against it.
 *
 * Null here means ABSENT, which is a third state distinct from published and
 * refused: a spot that is not a member of the intertidal is not in the grid at
 * all, so there is nothing for a rate to sit beside. A caller must not read that
 * as a refusal, because a refusal is a measured verdict and this is the absence
 * of a measurement.
 */
export function calibrationFor(slug: SpotSlug | string): SpotCalibration | null {
  return CALIBRATION_BY_SLUG[slug as CalibratedSlug] ?? null;
}

/** Whether this spot has a published rate table. False for absent and for refused alike. */
export function isPublished(slug: SpotSlug | string): boolean {
  return calibrationFor(slug)?.published === true;
}

/**
 * The bin a height falls in, or null when it falls outside every bin.
 *
 * Half-open `[lo, hi)`, matching the pipeline exactly, so a height landing on an
 * edge belongs to the bin above it and to exactly one bin. Null rather than a
 * clamp: a day whose low is +4 ft is outside anything this table describes, and
 * putting it in the top bin would let the calibration answer for a day it says
 * nothing about.
 */
export function binFor(
  calibration: SpotCalibration,
  lowFt: number,
): CalibrationBin | null {
  for (const bin of calibration.bins) {
    if (lowFt >= bin.lo_ft && lowFt < bin.hi_ft) return bin;
  }
  return null;
}

export const CALIBRATED_SPOT_COUNT = CALIBRATION.length;
