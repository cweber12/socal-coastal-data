/**
 * The N-interval solver: every maximal stretch of a tide series where a height
 * predicate holds.
 *
 * Pure, activity-neutral, and deliberately ignorant of what the predicate means.
 * It knows a series, a test on a height, and the levels that bound that test. It
 * does not know about floors, bands, reefs or swell, and it never decides
 * whether an interval is any good — that is an activity's judgement and lives
 * next door under `activities/`.
 *
 * ===========================================================================
 * Why there is no anchor parameter
 * ===========================================================================
 *
 * PRD #101 specified `solve(series, anchor, holds)` — "anchors on extrema of a
 * declared kind and walks outward while a height predicate holds". #129 built
 * the second occupant and that shape did not survive contact with it.
 *
 * An anchor-first solver has to name one extremum per interval BEFORE it knows
 * whether the interval contains one. Two real days from the committed 384-hour
 * fixture for station 9410230 say it cannot:
 *
 *   2026-07-22 gives two intervals against the 1.5–3.5 ft band. The first
 *   contains the 2.816 ft high at 05:51 AND the 2.503 ft low at 09:30. The
 *   second contains no turn at all — a pass-through on the ebb off the 5.017 ft
 *   high at 16:53, which sits above the band and outside the interval entirely.
 *
 *   2026-07-21 also puts a high and a low inside one interval, so the first is
 *   not a coincidence.
 *
 * So the extrema an interval happens to contain are REPORTED as a property of
 * the interval — zero, one or two — rather than supplied as an input.
 *
 * Tidepool's anchor did not disappear; it moved up a layer. "Which low is this
 * day about" is a selection OVER the intervals, and it belongs in tidepool's
 * policy because it is that activity's judgement. The two occupants already
 * disagree about it, which is the tell:
 *
 *   tidepool  today: the next low whose window has not shut. Other days: the
 *             best daylight low.
 *   surf      most decisive minutes, then most usable minutes, then earliest.
 *
 * Neither is more correct. They answer different questions, and a solver that
 * picked one would be imposing an activity's judgement on the other.
 *
 * ===========================================================================
 * The two bugs this walk exists to prevent
 * ===========================================================================
 *
 * Both are documented in `activities/tidepool/policy.ts` before this extraction
 * and both have a named regression test in solve.test.ts. An N-interval solver
 * has MORE ways to hit them, not fewer.
 *
 * 1. THE PHANTOM WINDOW. The obvious alternative — ask for every crossing of the
 *    level in the series, then take the nearest falling one before a turn and
 *    the nearest rising one after it — is wrong for a turn that never reaches
 *    the level: those two crossings belong to a DIFFERENT turn, usually the
 *    previous one. The pair spans the intervening high and yields a phantom
 *    window of ten or twelve hours. Real case: 27 July 2026 at Cabrillo, where
 *    the sub-floor low is at 03:21 in the dark and the afternoon low at 2.581 ft
 *    is far above the floor. The phantom made that afternoon low score a
 *    twelve-hour daylight window, won the day's ranking, and reported
 *    `above-floor` when the truth was `dark`.
 *
 *    Walking maximal runs cannot reach another turn. An interval is a set of
 *    consecutive samples that all satisfy the predicate, so nothing that fails
 *    it can be inside one.
 *
 * 2. THE EXACT-TIE MISS. A sample sitting exactly ON a bounding level emits no
 *    crossing: neither neighbouring pair straddles it. A crossing search then
 *    finds nothing on that side, falls back to the start of the series, and
 *    invents an interval running from whenever the series began. Predictions are
 *    quoted to three decimals and levels to one, so an exact tie is not exotic —
 *    of the 3,841 samples in the 384-hour fixture, exactly one reads `1.5`, at
 *    22:36 PDT on 2026-07-21, sitting precisely on the surf band's lower edge.
 *
 *    A run walk needs no special case for it. Both occupants' predicates are
 *    STRICT, so a sample on the level is the first sample OUT, and the crossing
 *    is interpolated between it and its in-band neighbour — landing on the
 *    sample's own instant, because that sample IS the level.
 *
 * A true excursion lasting less than one sample interval is missed. At the
 * 6-minute spacing CO-OPS serves that is a window under six minutes, far below
 * any activity's minimum-duration gate.
 */

import { findExtrema, type TideExtremum, type TideSeries } from '../feeds/coops-predictions';

/**
 * What makes a height workable, and which levels bound that.
 *
 * Two functions rather than one, because interpolating the crossing needs to
 * know WHICH level was crossed and `holds` cannot say. A one-sided predicate
 * returns the same level from `edgeFrom` every time; a two-sided one reads it
 * off the out-of-range sample.
 */
export interface HeightPredicate {
  /**
   * True when the height is inside the workable set.
   *
   * Strictness is the caller's decision and both occupants chose strict. See the
   * exact-tie note above for what that buys.
   */
  holds(ft: number): boolean;

  /**
   * Which level the tide crossed to get between an out-of-range sample and an
   * in-range one, read off the OUT sample.
   *
   * Read off the out sample rather than inferred from the direction of travel.
   * "Out of range" has only as many ways of being true as the predicate has
   * edges, so the out sample names its own edge — and the exactly-on case picks
   * the edge it is sitting on instead of falling through a direction test.
   */
  edgeFrom(outFt: number): number;
}

/** The span an interval must overlap to be returned. Normally one local day. */
export interface TimeWindow {
  startMs: number;
  /** Exclusive, matching every other local-day filter in this repo. */
  endMs: number;
}

/**
 * One maximal stretch of the series with the predicate holding.
 *
 * "Maximal" is doing work: two intervals are never adjacent, because a run that
 * touched another would be one run. What separates them is the tide leaving the
 * workable set, which is a real event with a time, not a gap in the sampling.
 */
export interface Interval {
  /** When the predicate started holding. Interpolated, or the first sample. */
  openMs: number;
  /** When it stopped. Interpolated, or the last sample. */
  closeMs: number;

  /** True when this run was already under way when the window began. */
  continuesBefore: boolean;
  /** True when it had not ended when the window did. */
  continuesAfter: boolean;

  /**
   * True when the run ran off either end of the PREDICTION SERIES, so its
   * reported length is a floor on the real one rather than the real one.
   *
   * Different from `continuesBefore`/`continuesAfter`, which are about the
   * window: a run crossing local midnight is an ordinary fact about the tide,
   * while a run cut off by the end of the payload is a fact about the payload.
   */
  seriesClipped: boolean;

  /**
   * The turning points inside this interval, in time order. Zero, one or two.
   *
   * Zero is a pass-through: the tide crossed the whole workable set on one ebb
   * or one flood without turning. One is the set bracketing a low or a high.
   * Two is the set holding a high and the low after it, which happens when the
   * day's range is small enough that consecutive turns both sit inside.
   *
   * Reported, never supplied — see the header.
   */
  anchors: TideExtremum[];
}

/** Instant at which the segment a→b passes `levelFt`, by linear interpolation. */
function crossingBetween(
  a: { tMs: number; ft: number },
  b: { tMs: number; ft: number },
  levelFt: number,
): number {
  const da = a.ft - levelFt;
  const db = b.ft - levelFt;
  if (da === db) return a.tMs;
  return Math.round(a.tMs + (da / (da - db)) * (b.tMs - a.tMs));
}

/**
 * Every maximal interval where `predicate` holds that overlaps `window`.
 *
 * One pass over the whole series, intersected with the window afterwards rather
 * than walked only over the window's samples. That is what lets an interval
 * already under way when the window opened report `continuesBefore` instead of
 * pretending it began at the boundary.
 */
export function solve(
  series: TideSeries,
  predicate: HeightPredicate,
  window: TimeWindow,
): Interval[] {
  const samples = series.samples;
  if (samples.length === 0) return [];

  const extrema = findExtrema(series);
  const last = samples.length - 1;

  const build = (l: number, r: number): Interval => {
    const openMs =
      l === 0
        ? samples[0]!.tMs
        : crossingBetween(samples[l - 1]!, samples[l]!, predicate.edgeFrom(samples[l - 1]!.ft));
    const closeMs =
      r === last
        ? samples[r]!.tMs
        : crossingBetween(samples[r]!, samples[r + 1]!, predicate.edgeFrom(samples[r + 1]!.ft));

    return {
      openMs,
      closeMs,
      continuesBefore: openMs < window.startMs,
      continuesAfter: closeMs > window.endMs,
      seriesClipped: l === 0 || r === last,
      anchors: extrema.filter((e) => e.tMs >= openMs && e.tMs <= closeMs),
    };
  };

  const intervals: Interval[] = [];
  let runStart = -1;

  for (let i = 0; i <= last; i++) {
    const here = predicate.holds(samples[i]!.ft);
    if (here && runStart === -1) runStart = i;
    if (!here && runStart !== -1) {
      intervals.push(build(runStart, i - 1));
      runStart = -1;
    }
  }
  // Still holding when the series ran out.
  if (runStart !== -1) intervals.push(build(runStart, last));

  return intervals.filter((i) => i.closeMs > window.startMs && i.openMs < window.endMs);
}

/**
 * The interval an instant falls inside, or null.
 *
 * The primitive an activity's selection rule is written on top of: "which
 * interval is this low's excursion" is answered by asking which one contains a
 * sample the low is sitting on. Intervals are disjoint, so at most one matches.
 */
export function intervalAt(intervals: readonly Interval[], tMs: number): Interval | null {
  return intervals.find((i) => i.openMs <= tMs && tMs <= i.closeMs) ?? null;
}
