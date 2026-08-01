/**
 * Surf's own thresholds: the two per-spot swell ceilings, and nothing else.
 *
 * This is the whole of `activities/surf/` for now. #129 builds the predicate;
 * what landed here first is the data, because #128 had to put the per-spot
 * overrides somewhere and `shared/thresholds.json` was the wrong somewhere --
 * a corridor-wide file holding two judgements about one activity nobody has
 * built. See docs/adr/0012.
 *
 * ---------------------------------------------------------------------------
 * Nothing computes a surf verdict yet, and this is still not dead code
 * ---------------------------------------------------------------------------
 *
 * `SURF_UNRESOLVED` is read today, by the corridor page's unresolved
 * disclosure. That matters more than it sounds: these two overrides were
 * already inert before the move, and moving them into a file nothing read
 * would have taken their caveats off the page -- a caveat recorded and then
 * not shown, which is the exact failure core/components/unresolved.tsx was
 * written to end. So the disclosure takes its sources as a prop from the
 * composition root now, and this file is one of them.
 *
 * `swellCeilingFor` is exported and has no caller until #129. It is here
 * because the shape of the answer is decided by the data, not by the
 * predicate, and writing it beside the file it reads is what stops #129
 * inventing a second reading of the same JSON.
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

export const SURF_THRESHOLDS_VERSION = FILE.version;
export const SURF_UNRESOLVED: readonly string[] = FILE.unresolved;

/** Slugs carrying a surf-specific ceiling. Two, both uncalibrated author estimates. */
export const SURF_OVERRIDE_SLUGS: readonly string[] = Object.keys(FILE.overrides);

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
