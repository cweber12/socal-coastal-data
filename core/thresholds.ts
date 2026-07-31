/**
 * Swell ceilings, read from shared/thresholds.json.
 *
 * Deliberately not in spots.json. That file holds values resolved by join
 * against data.ca.gov and CDFW ds582, and its own _schema warns against
 * hand-populating resolved fields. Ceilings are author guesses, so they live
 * apart and carry their confidence with them.
 *
 * Nothing here is calibrated. Every value this module returns is labelled
 * `uncalibrated`, and the UI is expected to say so wherever a ceiling drives a
 * veto.
 */

import thresholdsJson from '@/shared/thresholds.json';
import type { SpotSlug } from '@/shared/spots.generated';

export type ThresholdConfidence = 'uncalibrated' | 'calibrated';

interface ThresholdsFile {
  version: string;
  units: string;
  default_swell_ceiling_ft: number;
  default_confidence: ThresholdConfidence;
  overrides: Record<string, { swell_ceiling_ft: number; confidence: ThresholdConfidence; reason: string }>;
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
export const THRESHOLDS_UNRESOLVED: readonly string[] = FILE.unresolved;

export function swellCeilingFor(slug: SpotSlug): SwellCeiling {
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
    ceilingFt: FILE.default_swell_ceiling_ft,
    confidence: FILE.default_confidence,
    reason: null,
    isDefault: true,
  };
}
