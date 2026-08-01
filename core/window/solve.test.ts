import { describe, expect, it } from 'vitest';

import { intervalAt, solve, type HeightPredicate } from './solve';
import { findExtrema } from '../feeds/coops-predictions';
import { localDayBounds, type LocalDate } from '../time';
import {
  expectNearMinute,
  flatSeries,
  loadCoopsFixture,
  pacific,
  seriesFromTurns,
  ZONE,
} from './__testing__/series';

/** Tidepool's shape: one-sided, strict, one level. */
const below = (floorFt: number): HeightPredicate => ({
  holds: (ft) => ft < floorFt,
  edgeFrom: () => floorFt,
});

/** Surf's shape: two-sided, strict, the edge read off the out sample. */
const between = (minFt: number, maxFt: number): HeightPredicate => ({
  holds: (ft) => minFt < ft && ft < maxFt,
  edgeFrom: (outFt) => (outFt <= minFt ? minFt : maxFt),
});

const dayOf = (date: LocalDate) => {
  const { startMs, endMs } = localDayBounds(date, ZONE);
  return { startMs, endMs };
};

const JULY_21: LocalDate = { year: 2026, month: 7, day: 21 };
const JULY_22: LocalDate = { year: 2026, month: 7, day: 22 };
const JULY_27: LocalDate = { year: 2026, month: 7, day: 27 };

const fortnight = loadCoopsFixture('coops-9410230-20260713-384h.json');
const july27 = loadCoopsFixture('coops-9410230-20260727-6min.json');

/* =========================================================================
 * What "maximal run" means
 * ======================================================================= */

describe('maximal runs', () => {
  it('returns intervals in time order, disjoint, and never adjacent', () => {
    const intervals = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));
    expect(intervals.length).toBeGreaterThan(1);
    for (let i = 1; i < intervals.length; i++) {
      // Two runs that touched would be one run. What separates them is the tide
      // leaving the workable set, which is a real event with a time.
      expect(intervals[i]!.openMs).toBeGreaterThan(intervals[i - 1]!.closeMs);
    }
  });

  it('never contains a sample the predicate rejects', () => {
    // The property the phantom window violates, stated over the whole fortnight
    // rather than on one day.
    const predicate = between(1.5, 3.5);
    for (let day = 13; day <= 27; day++) {
      const window = dayOf({ year: 2026, month: 7, day });
      for (const interval of solve(fortnight, predicate, window)) {
        for (const sample of fortnight.samples) {
          if (sample.tMs <= interval.openMs || sample.tMs >= interval.closeMs) continue;
          expect(predicate.holds(sample.ft), `${new Date(sample.tMs).toISOString()}`).toBe(true);
        }
      }
    }
  });

  it('is one interval spanning everything when the predicate never stops holding', () => {
    const intervals = solve(flatSeries(JULY_27, 2.5), between(1.5, 3.5), dayOf(JULY_27));
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.seriesClipped).toBe(true);
    expect(intervals[0]!.continuesBefore).toBe(true);
    expect(intervals[0]!.continuesAfter).toBe(true);
  });

  it('is nothing at all when the predicate never holds', () => {
    expect(solve(flatSeries(JULY_27, 5.0), between(1.5, 3.5), dayOf(JULY_27))).toEqual([]);
    expect(solve(flatSeries(JULY_27, 0.4), between(1.5, 3.5), dayOf(JULY_27))).toEqual([]);
  });

  it('flags a run cut off by the end of the payload, separately from one crossing midnight', () => {
    // `seriesClipped` is a fact about the payload; `continuesAfter` is a fact
    // about the tide. Conflating them would report an ordinary session that runs
    // past midnight as a length that is only a minimum.
    const lastDay = solve(fortnight, between(1.5, 3.5), dayOf({ year: 2026, month: 7, day: 28 }));
    const clipped = lastDay.filter((i) => i.seriesClipped);
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every((i) => i.closeMs <= fortnight.samples[fortnight.samples.length - 1]!.tMs))
      .toBe(true);
  });
});

/* =========================================================================
 * The extrema an interval contains, reported rather than supplied
 * ======================================================================= */

describe('anchors', () => {
  it('reports zero, one and two turns, all three on real days inside one fortnight', () => {
    /*
     * The finding that changed the spec. PRD #101 asked for
     * `solve(series, anchor, holds)`; an anchor-first solver has to name one
     * extremum per interval BEFORE it knows whether the interval contains one.
     *
     * 2026-07-22 against the shipped band: the first interval holds the 2.816 ft
     * high at 05:51 AND the 2.503 ft low at 09:30; the second holds no turn at
     * all -- a pass-through on the ebb off the 5.017 ft high at 16:53, which
     * sits above the band and outside the interval entirely.
     */
    const [first, second] = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));

    expect(first!.anchors.map((a) => a.kind)).toEqual(['high', 'low']);
    expect(first!.anchors[0]!.ft).toBeCloseTo(2.816, 2);
    expect(first!.anchors[1]!.ft).toBeCloseTo(2.503, 2);

    expect(second!.anchors).toHaveLength(0);

    // And a one-turn interval, so all three counts are exercised.
    const oneTurn = solve(july27, below(1.3), dayOf(JULY_27)).filter(
      (i) => i.anchors.length === 1,
    );
    expect(oneTurn.length).toBeGreaterThan(0);
    expect(oneTurn[0]!.anchors[0]!.kind).toBe('low');
  });

  it('is not fooled by a plateau at the turn', () => {
    /*
     * The 05:51 high on 2026-07-22 is two adjacent samples at the same height.
     * `findExtrema` collapses runs of equal height precisely so a tie at the
     * turn is still a candidate; the first survey of this fixture, written in
     * Python with strict comparisons, reported this interval as holding one turn.
     */
    const [first] = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));
    expect(first!.anchors).toHaveLength(2);
  });

  it('reports only turns inside the interval', () => {
    for (const interval of solve(fortnight, between(1.5, 3.5), dayOf(JULY_21))) {
      for (const anchor of interval.anchors) {
        expect(anchor.tMs).toBeGreaterThanOrEqual(interval.openMs);
        expect(anchor.tMs).toBeLessThanOrEqual(interval.closeMs);
      }
    }
  });
});

/* =========================================================================
 * REGRESSION: the phantom window
 *
 * Reverting the fix means answering "which interval is this turn's" with a
 * neighbouring turn's crossings instead of with containment. Both assertions
 * below fail against that.
 * ======================================================================= */

describe('regression: the phantom window', () => {
  const CABRILLO_FLOOR_BEFORE_1_2_0 = -0.2;

  it('gives a turn that never reaches the level no interval, rather than a different turn’s', () => {
    /*
     * Real case: 27 July 2026 at Cabrillo, held at -0.2 ft -- Cabrillo's floor
     * before spots.json 1.2.0 -- because that is the exact configuration the bug
     * appeared in. The shallowest floor in the corridor, cleared by one low and
     * one low only.
     *
     * Taking the nearest falling crossing before the afternoon low and the
     * nearest rising one after it picks up crossings belonging to the 03:21 low.
     * The pair spans the intervening high and yields a phantom window of ten or
     * twelve hours, which then wins the day's "best daylight low" ranking and
     * makes the day read `above-floor` when the truth is `dark`.
     */
    const window = dayOf(JULY_27);
    const intervals = solve(july27, below(CABRILLO_FLOOR_BEFORE_1_2_0), window);

    // One sub-floor excursion that day, around the 03:21 low.
    expect(intervals).toHaveLength(1);
    expectNearMinute(intervals[0]!.anchors[0]!.tMs, pacific(JULY_27, 3, 21), 120);
    expect(intervals[0]!.anchors[0]!.ft).toBeCloseTo(-0.324, 2);

    // The afternoon low at 2.581 ft is inside no interval. This is the
    // assertion: not "its window is short" but "it has none".
    const afternoonLow = findExtrema(july27).find(
      (e) => e.kind === 'low' && e.tMs > pacific(JULY_27, 12) && e.tMs < window.endMs,
    )!;
    expect(afternoonLow.ft).toBeCloseTo(2.581, 2);
    expect(intervalAt(intervals, afternoonLow.tMs)).toBeNull();
  });

  it('never yields a ten-to-twelve-hour interval where the tide crossed a high', () => {
    // The phantom's signature is its LENGTH: it spans an intervening high. The
    // real sub-floor excursion here is a couple of hours.
    const intervals = solve(july27, below(CABRILLO_FLOOR_BEFORE_1_2_0), dayOf(JULY_27));
    for (const interval of intervals) {
      const hours = (interval.closeMs - interval.openMs) / 3_600_000;
      expect(hours, `${hours.toFixed(1)} h interval`).toBeLessThan(6);
      expect(interval.anchors.filter((a) => a.kind === 'high')).toHaveLength(0);
    }
  });
});

/* =========================================================================
 * REGRESSION: the exact-tie miss
 *
 * Reverting the fix means finding the boundary by searching for a straddling
 * pair of samples, which a sample sitting ON the level does not produce: the
 * search finds nothing, falls back to the start of the series, and invents an
 * interval running from whenever the series began.
 * ======================================================================= */

describe('regression: the exact-tie miss', () => {
  it('ends a run on the sample that reads exactly the level (2026-07-21, 22:36)', () => {
    /*
     * Real rather than constructed. Of the 3,841 samples in this fixture exactly
     * one reads `1.5`: 22:36 PDT on 2026-07-21, sitting precisely on the band's
     * lower edge. The band is strict, so that sample is the first one OUT, and
     * the exit crossing interpolates between 22:30 at 1.529 ft and 22:36 at
     * 1.500 ft -- landing on 22:36:00 exactly, because the second point IS the
     * level.
     */
    const onTheLevel = fortnight.samples.filter((s) => s.ft === 1.5);
    expect(onTheLevel).toHaveLength(1);
    expect(onTheLevel[0]!.tMs).toBe(pacific(JULY_21, 22, 36));

    const intervals = solve(fortnight, between(1.5, 3.5), dayOf(JULY_21));
    const last = intervals[intervals.length - 1]!;
    expect(last.closeMs).toBe(pacific(JULY_21, 22, 36));
  });

  it('does not invent an interval running from the start of the series', () => {
    // The failure mode by name. A boundary search that finds no straddling pair
    // and falls back to samples[0] produces an interval hours or days long,
    // opening at the first sample the payload happens to carry.
    const intervals = solve(fortnight, between(1.5, 3.5), dayOf(JULY_21));
    const seriesStartMs = fortnight.samples[0]!.tMs;
    for (const interval of intervals) {
      expect(interval.openMs).not.toBe(seriesStartMs);
      expect(interval.openMs).toBeGreaterThan(pacific(JULY_21, 0) - 24 * 3_600_000);
    }
  });

  it('opens no interval for a tide that only touches the level and falls away', () => {
    /*
     * The constructed twin of the case above, on the other side of the edge: a
     * tide rising to touch 1.5 and falling back. One sample reads 1.500 and its
     * neighbours are below, so a solver using `<=` opens an interval lasting one
     * sample interval and a strict one opens none. Six minutes is far under any
     * duration gate, so the STATE is the same and the interval COUNT is not --
     * which is what a reader sees on the cell face.
     */
    const touching = seriesFromTurns(JULY_27, [
      { hour: 12, ft: 0.5, dayOffset: -1 },
      { hour: 0, ft: 0.5 },
      { hour: 12, ft: 1.5 },
      { hour: 23, minute: 59, ft: 0.5 },
      { hour: 12, ft: 0.5, dayOffset: 1 },
      { hour: 12, ft: 0.5, dayOffset: 2 },
    ]);
    expect(solve(touching, between(1.5, 3.5), dayOf(JULY_27))).toEqual([]);
  });

  it('interpolates each end against the edge it actually crossed', () => {
    // A two-sided predicate leaves the workable set by whichever edge it
    // reaches, and which one is not implied by the direction of travel once a
    // sample can sit exactly on either. Read off the OUT sample.
    const intervals = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));
    const [first] = intervals;
    // 1.5 rising 00:44:52, then 3.5 rising 12:59:12 -- in at the bottom, out at
    // the top, both read off the fixture before the solver existed.
    expect(first!.openMs).toBeCloseTo(pacific(JULY_22, 0, 44) + 52_000, -4);
    expect(first!.closeMs).toBeCloseTo(pacific(JULY_22, 12, 59) + 12_000, -4);
  });
});

/* =========================================================================
 * The window
 * ======================================================================= */

describe('the time window', () => {
  it('keeps a run that overlaps it and drops one that does not', () => {
    const july22 = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));
    const july21 = solve(fortnight, between(1.5, 3.5), dayOf(JULY_21));
    for (const interval of july22) {
      expect(interval.closeMs).toBeGreaterThan(dayOf(JULY_22).startMs);
      expect(interval.openMs).toBeLessThan(dayOf(JULY_22).endMs);
    }
    // The two days do not report the same runs, so the filter is doing something.
    expect(july21.map((i) => i.openMs)).not.toEqual(july22.map((i) => i.openMs));
  });

  it('reports a run already under way when the window opened, rather than trimming it', () => {
    // Why the walk runs over the whole series and intersects afterwards. This
    // run opened the previous evening; reporting it as starting at 00:00 with no
    // flag would be a claim the tide crossed the edge at midnight.
    const first = solve(fortnight, between(1.5, 3.5), dayOf(JULY_21))[0]!;
    expect(first.continuesBefore).toBe(true);
    expect(first.openMs).toBeLessThan(dayOf(JULY_21).startMs);
  });
});

describe('intervalAt', () => {
  const intervals = solve(fortnight, between(1.5, 3.5), dayOf(JULY_22));

  it('finds the interval an instant falls inside, and null outside every one', () => {
    const inside = intervals[0]!;
    expect(intervalAt(intervals, inside.openMs)).toBe(inside);
    expect(intervalAt(intervals, inside.closeMs)).toBe(inside);
    expect(intervalAt(intervals, (inside.openMs + inside.closeMs) / 2)).toBe(inside);
    expect(intervalAt(intervals, inside.closeMs + 1)).toBeNull();
    expect(intervalAt(intervals, inside.openMs - 1)).toBeNull();
  });

  it('returns null rather than the nearest one', () => {
    // The whole point. "Nearest" is how a turn ends up carrying a different
    // turn's crossings, which is the phantom window above.
    expect(intervalAt(intervals, dayOf(JULY_22).startMs - 6 * 3_600_000)).toBeNull();
  });
});

describe('refusals', () => {
  it('returns nothing for a series with no samples', () => {
    const empty = { ...fortnight, samples: [], uniformStepMs: null };
    expect(solve(empty, below(1.0), dayOf(JULY_22))).toEqual([]);
  });
});
