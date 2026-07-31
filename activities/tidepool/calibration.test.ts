/**
 * The calibration read path, and the bin lookup the day chart's marker depends
 * on.
 *
 * The assertions here are about what a CONSUMER can and cannot do with the file,
 * because the whole point of generating a discriminated union for it is that
 * five of eight spots refuse and a refusal must be impossible to render as a
 * pass.
 */

import { describe, expect, it } from 'vitest';

import {
  BIN_EDGES_FT,
  CALIBRATION_DATUM,
  CALIBRATION_TIDE_STATION,
  PUBLISHED_SLUGS,
  USABLE_BIN_MIN_VISITS,
  binFor,
  calibrationFor,
  isPublished,
  type SpotCalibration,
} from './calibration';
import { TIDEPOOL_SPOTS } from '@/shared/spots.generated';

/** A spot that publishes, for the cases that need real bins. */
const PUBLISHED = calibrationFor(PUBLISHED_SLUGS[0]!) as Extract<
  SpotCalibration,
  { published: true }
>;

describe('the file this module reads', () => {
  it('is in the units and at the station lib/windows.ts compares against', () => {
    // The module throws on load otherwise. Asserted so the guard is visible as a
    // property rather than only as a line of code nobody exercises.
    expect(CALIBRATION_DATUM).toBe('MLLW');
    expect(CALIBRATION_TIDE_STATION).toBe('9410230');
  });

  it('covers every spot the grid can evaluate', () => {
    // A spot in the grid with no calibration entry would leave the day page
    // silently panel-less for a reason nobody stated.
    for (const spot of TIDEPOOL_SPOTS) {
      expect(calibrationFor(spot.slug)).not.toBeNull();
    }
  });

  it('publishes a minority of spots, which is the expected outcome', () => {
    // Three of eight on the current corpus. If this ever became eight of eight
    // without the gates changing, something upstream would have changed a great
    // deal and it should be looked at rather than celebrated.
    expect(PUBLISHED_SLUGS.length).toBeLessThan(TIDEPOOL_SPOTS.length);
    expect(PUBLISHED_SLUGS.length).toBeGreaterThan(0);
  });
});

describe('a refused spot', () => {
  const refused = TIDEPOOL_SPOTS.map((s) => calibrationFor(s.slug)).filter(
    (c): c is Extract<SpotCalibration, { published: false }> => c?.published === false,
  );

  it('exists on the current corpus, so this is the common branch', () => {
    expect(refused.length).toBeGreaterThan(0);
  });

  it('always carries a reason, and a published spot never does', () => {
    /*
     * The rule the generated union enforces at compile time, asserted at run
     * time as well: there is no member in which a rate stands without the reason
     * it might be missing. A `null` rate that does not say why is exactly what
     * shared/spots.json warns must never render as a pass.
     */
    for (const spot of TIDEPOOL_SPOTS) {
      const calibration = calibrationFor(spot.slug)!;
      if (calibration.published) {
        expect(calibration.null_reason).toBeNull();
      } else {
        expect(typeof calibration.null_reason).toBe('string');
        expect(calibration.null_reason.length).toBeGreaterThan(20);
      }
    }
  });

  it('names the criteria it failed', () => {
    for (const calibration of refused) {
      expect(calibration.null_reason).toMatch(
        /too-few-usable-bins|not-declining|amplitude-below-gate|observer-concentration/,
      );
    }
  });

  it('reports isPublished false, the same as an absent spot', () => {
    // Both mean "no rate to render". They differ in WHY, which is why the
    // caller reads the union rather than this helper when it needs to say so.
    for (const calibration of refused) expect(isPublished(calibration.slug)).toBe(false);
    expect(isPublished('oceanside-pier')).toBe(false);
    expect(calibrationFor('oceanside-pier')).toBeNull();
  });
});

describe('binFor', () => {
  it('finds the bin a height falls in', () => {
    const bin = binFor(PUBLISHED, -1.2)!;
    expect(bin.lo_ft).toBe(-2.5);
    expect(bin.hi_ft).toBe(-1);
  });

  it('puts a height exactly on an edge in the bin above it', () => {
    // Half-open [lo, hi), matching the pipeline. A value on an edge belongs to
    // exactly one bin, and it is the upper one.
    expect(binFor(PUBLISHED, -1.0)!.lo_ft).toBe(-1);
    expect(binFor(PUBLISHED, 0)!.lo_ft).toBe(0);
    expect(binFor(PUBLISHED, -2.5)!.lo_ft).toBe(-2.5);
  });

  it('returns null below the lowest bin rather than clamping into it', () => {
    // A -3 ft low is outside anything the record covers. Clamping would let the
    // chart answer for a day the calibration says nothing about.
    expect(binFor(PUBLISHED, -2.6)).toBeNull();
    expect(binFor(PUBLISHED, -10)).toBeNull();
  });

  it('returns null above the highest bin, including exactly on its upper edge', () => {
    const top = BIN_EDGES_FT[BIN_EDGES_FT.length - 1]!;
    expect(binFor(PUBLISHED, top)).toBeNull();
    expect(binFor(PUBLISHED, top + 1)).toBeNull();
  });

  it('finds an unusable bin rather than skipping it', () => {
    /*
     * A thin bin is still the right bin. Skipping it would silently place the
     * day in a neighbouring band and report that band's rate for it, which is a
     * wrong number rather than a missing one. Suppression is a DISPLAY decision
     * made after the lookup, never inside it.
     */
    const thin = PUBLISHED.bins.find((b) => !b.usable && b.visits > 0);
    if (thin) {
      const mid = (thin.lo_ft + thin.hi_ft) / 2;
      expect(binFor(PUBLISHED, mid)!.lo_ft).toBe(thin.lo_ft);
      expect(thin.visits).toBeLessThan(USABLE_BIN_MIN_VISITS);
    }
  });

  it('covers the whole span with no gap and no overlap', () => {
    // Every 0.05 ft step from the bottom edge to the top must land in exactly
    // one bin, and the bins must be contiguous.
    for (let ft = BIN_EDGES_FT[0]!; ft < BIN_EDGES_FT.at(-1)!; ft += 0.05) {
      const matches = PUBLISHED.bins.filter((b) => ft >= b.lo_ft && ft < b.hi_ft);
      expect(matches).toHaveLength(1);
    }
  });
});

describe('the published bins themselves', () => {
  it('never carry a rate on an empty bin, or an empty rate on a full one', () => {
    for (const slug of PUBLISHED_SLUGS) {
      for (const bin of calibrationFor(slug)!.bins) {
        expect(bin.rate === null).toBe(bin.visits === 0);
        expect(bin.hits).toBeLessThanOrEqual(bin.visits);
        if (bin.rate !== null) expect(bin.rate).toBeCloseTo(bin.hits / bin.visits, 10);
      }
    }
  });

  it('agree with the bin edges the generator emitted', () => {
    for (const slug of PUBLISHED_SLUGS) {
      const bins = calibrationFor(slug)!.bins;
      expect(bins).toHaveLength(BIN_EDGES_FT.length - 1);
      bins.forEach((bin, i) => {
        expect(bin.lo_ft).toBe(BIN_EDGES_FT[i]);
        expect(bin.hi_ft).toBe(BIN_EDGES_FT[i + 1]);
      });
    }
  });
});
