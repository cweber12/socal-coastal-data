/**
 * Surf's thresholds, before there is a surf predicate to spend them.
 *
 * What is worth asserting on a file nothing computes with yet is the part that
 * would be silently wrong later: that the corridor default is READ rather than
 * copied, and that the two overrides are still labelled as the estimates they
 * are. A second hand-written 3.0 ft here is the kind of thing that agrees with
 * shared/thresholds.json on the day it is written and disagrees a year later.
 */

import { describe, expect, it } from 'vitest';

import {
  SURF_OVERRIDE_SLUGS,
  SURF_THRESHOLDS_VERSION,
  SURF_UNRESOLVED,
  swellCeilingFor,
} from './thresholds';
import { DEFAULT_SWELL_CEILING_FT, DEFAULT_SWELL_CONFIDENCE } from '@/core/thresholds';
import { SPOT_BY_SLUG } from '@/shared/spots.generated';

describe('the overrides', () => {
  it('are the two spots whose own records justify one, and no others', () => {
    // Not a list this test invents: shared/thresholds.json said for months that
    // these are "the only two swell offsets spots.json actually justifies".
    expect([...SURF_OVERRIDE_SLUGS].sort()).toEqual(['blacks-beach', 'tourmaline']);
  });

  it('name real spots', () => {
    // An override keyed to a slug that does not exist is a threshold that can
    // never be applied and would never fail anywhere.
    for (const slug of SURF_OVERRIDE_SLUGS) {
      expect(SPOT_BY_SLUG[slug as keyof typeof SPOT_BY_SLUG]).toBeDefined();
    }
  });

  it('are uncalibrated, and say why they differ', () => {
    for (const slug of SURF_OVERRIDE_SLUGS) {
      const ceiling = swellCeilingFor(slug);
      expect(ceiling.isDefault).toBe(false);
      expect(ceiling.confidence).toBe('uncalibrated');
      // The reason quotes the spot record that justifies the number. An override
      // without one is a number nobody downstream can check.
      expect(ceiling.reason).toBeTruthy();
      expect(ceiling.reason!.length).toBeGreaterThan(20);
    }
  });
});

describe('a spot with no override', () => {
  it('reads the corridor default rather than a copy of it', () => {
    /*
     * The property this file exists to protect. `shared/thresholds.json` holds
     * the corridor default and this module falls back to it by import -- if it
     * ever holds its own 3.0, the two agree on the day it is written and drift
     * silently afterwards, which is the failure the whole shared/ layer is for.
     */
    const ceiling = swellCeilingFor('swamis');
    expect(ceiling.isDefault).toBe(true);
    expect(ceiling.ceilingFt).toBe(DEFAULT_SWELL_CEILING_FT);
    expect(ceiling.confidence).toBe(DEFAULT_SWELL_CONFIDENCE);
    expect(ceiling.reason).toBeNull();
  });
});

describe('what this file discloses', () => {
  it('carries caveats, which are rendered even though nothing computes with them', () => {
    // These two entries were on the page before the values moved here. A value
    // changing file must not take its caveat off the page -- see ADR 0012, and
    // app/unresolved-sources.ts, which is what puts them back on it.
    expect(SURF_UNRESOLVED.length).toBeGreaterThan(0);
    for (const entry of SURF_UNRESOLVED) expect(entry.length).toBeGreaterThan(20);
    expect(SURF_THRESHOLDS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
