/**
 * The CORRIDOR-WIDE swell ceiling, read from shared/thresholds.json.
 *
 * Deliberately not in spots.json. That file holds values resolved by join
 * against data.ca.gov and CDFW ds582, and its own _schema warns against
 * hand-populating resolved fields. A ceiling is an author estimate, so it lives
 * apart and carries its confidence with it.
 *
 * Nothing here is calibrated. Every value this module returns is labelled
 * `uncalibrated`, and the UI is expected to say so wherever a ceiling drives a
 * veto.
 *
 * ---------------------------------------------------------------------------
 * Per-spot overrides are NOT here any more
 * ---------------------------------------------------------------------------
 *
 * This module used to hold two, for blacks-beach and tourmaline. Both are
 * judgements about how those spots' BREAKS differ, both spots are outside the
 * intertidal grid, and neither ever changed a rendered verdict -- so what they
 * really were was surf's data sitting in a corridor-wide file, read by a
 * corridor-wide module, on behalf of an activity nobody had built. They are in
 * activities/surf/thresholds.json now (#128), and the reader that applies them
 * is that activity's.
 *
 * What is left is genuinely corridor-wide: one number that applies to every
 * spot nothing specific has been said about. `swellCeilingFor` still takes a
 * slug, and still answers the same for all of them -- the seam is kept because
 * an activity's override layer is what plugs into it, and #135 is the path by
 * which any of these stops being an estimate.
 */

import thresholdsJson from '@/shared/thresholds.json';
import type { SpotSlug } from '@/shared/spots.generated';

export type ThresholdConfidence = 'uncalibrated' | 'calibrated';

interface ThresholdsFile {
  version: string;
  units: string;
  default_swell_ceiling_ft: number;
  default_confidence: ThresholdConfidence;
  unresolved: string[];
}

const FILE = thresholdsJson as unknown as ThresholdsFile;

if (FILE.units !== 'ft') {
  // The ceiling is compared against a wave height in feet. A metric file would
  // veto everything above about a foot.
  throw new Error(
    `shared/thresholds.json declares units ${JSON.stringify(FILE.units)}; this module ` +
      'compares against feet and will not convert on an unrecognised unit.',
  );
}

export interface SwellCeiling {
  ceilingFt: number;
  confidence: ThresholdConfidence;
  /** Present only for an override, explaining why this spot differs. */
  reason: string | null;
  /** True when the corridor default was used because there is no override. */
  isDefault: boolean;
}

export const THRESHOLDS_VERSION = FILE.version;
export const DEFAULT_SWELL_CEILING_FT = FILE.default_swell_ceiling_ft;
export const DEFAULT_SWELL_CONFIDENCE = FILE.default_confidence;
export const THRESHOLDS_UNRESOLVED: readonly string[] = FILE.unresolved;

/**
 * The ceiling for a spot, which is the corridor default for every spot.
 *
 * `isDefault` is therefore true on every answer this returns today, and it is
 * kept rather than deleted because it is the field the UI reads to say "corridor
 * default, no per-spot calibration" -- which is exactly what is true, and was
 * true of all eight rendered spots before the overrides moved out as well.
 */
export function swellCeilingFor(_slug: SpotSlug): SwellCeiling {
  return {
    ceilingFt: FILE.default_swell_ceiling_ft,
    confidence: FILE.default_confidence,
    reason: null,
    isDefault: true,
  };
}
