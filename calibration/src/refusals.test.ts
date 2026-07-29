/**
 * The refusal criteria, each tripped by a synthetic case built to trip exactly
 * it.
 *
 * The point of building them one at a time is that on the real corpus they
 * co-occur -- La Jolla Shores fails both `not-declining` and
 * `amplitude-below-gate` -- so a test against real data cannot show that either
 * one works on its own.
 *
 * The other property asserted here is that EVERY criterion is evaluated even
 * after one has failed. A refusal that only reported the first tripped gate
 * would make a spot one visit short of a usable bin look identical to a
 * diver-contaminated one.
 */

import { describe, expect, it } from 'vitest';

import { BINS, type BinResult, type PlacedVisit } from './join.ts';
import { evaluateRefusals } from './refusals.ts';
import {
  MAX_SINGLE_OBSERVER_SHARE,
  MIN_AMPLITUDE_RATIO,
  MIN_CONCORDANT_PAIRS,
  MIN_USABLE_BINS,
  USABLE_BIN_MIN_VISITS,
} from './config.ts';

/** A bin table straight from (visits, rate) pairs. */
function bins(rows: { visits: number; rate: number }[]): BinResult[] {
  return BINS.map((bin, i) => {
    const row = rows[i] ?? { visits: 0, rate: 0 };
    return {
      index: i,
      label: bin.label,
      loFt: bin.loFt,
      hiFt: bin.hiFt,
      visits: row.visits,
      hits: Math.round(row.visits * row.rate),
      rate: row.visits === 0 ? null : row.rate,
      usable: row.visits >= USABLE_BIN_MIN_VISITS,
    };
  });
}

/** `count` visits spread across `observers` logins. */
function visits(count: number, observers = count): PlacedVisit[] {
  return Array.from({ length: count }, (_, i) => ({
    observerLogin: `observer-${i % observers}`,
    observedOn: { year: 2026, month: 1, day: 1 },
    recordCount: 1,
    isHit: false,
    medianObservedAtMs: null,
    matchedTaxonIds: [],
    minDistanceM: 0,
    nullAccuracyRecords: 0,
    impreciseRecords: 0,
    dayLowFt: 0,
    dayLowMs: 0,
    binIndex: 0,
  }));
}

/** A table that passes everything, as the baseline each case perturbs. */
const CLEAN = bins([
  { visits: 100, rate: 0.7 },
  { visits: 100, rate: 0.5 },
  { visits: 100, rate: 0.3 },
  { visits: 100, rate: 0.1 },
]);

describe('a clean spot publishes', () => {
  it('passes all four criteria', () => {
    const verdict = evaluateRefusals(CLEAN, visits(400));
    expect(verdict.publishes).toBe(true);
    expect(verdict.nullReason).toBeNull();
    expect(verdict.criteria.every((c) => c.passed)).toBe(true);
  });
});

describe('too-few-usable-bins', () => {
  it('fires when fewer than three bins reach the visit floor', () => {
    // Two fat bins and two that are one visit short. The rates still decline and
    // the amplitude is 7x, so nothing but this criterion should fail.
    const table = bins([
      { visits: 100, rate: 0.7 },
      { visits: 100, rate: 0.1 },
      { visits: USABLE_BIN_MIN_VISITS - 1, rate: 0.05 },
      { visits: USABLE_BIN_MIN_VISITS - 1, rate: 0.05 },
    ]);
    const verdict = evaluateRefusals(table, visits(228));

    const criterion = verdict.criteria.find((c) => c.code === 'too-few-usable-bins')!;
    expect(criterion.passed).toBe(false);
    expect(criterion.value).toBe(2);
    expect(criterion.threshold).toBe(MIN_USABLE_BINS);
    expect(verdict.publishes).toBe(false);
    expect(verdict.nullReason).toContain('too-few-usable-bins');
  });

  it('does not fire at exactly the threshold', () => {
    const table = bins([
      { visits: 100, rate: 0.7 },
      { visits: 100, rate: 0.4 },
      { visits: USABLE_BIN_MIN_VISITS, rate: 0.1 },
    ]);
    expect(
      evaluateRefusals(table, visits(215)).criteria.find((c) => c.code === 'too-few-usable-bins')!
        .passed,
    ).toBe(true);
  });
});

describe('not-declining', () => {
  it('fires on a table that climbs with the tide, which is the diver signature', () => {
    // La Jolla Shores' shape: the rate rises with height, peaking in the top bin.
    const table = bins([
      { visits: 100, rate: 0.5 },
      { visits: 100, rate: 0.7 },
      { visits: 100, rate: 0.75 },
      { visits: 100, rate: 0.9 },
    ]);
    const verdict = evaluateRefusals(table, visits(400));

    const criterion = verdict.criteria.find((c) => c.code === 'not-declining')!;
    expect(criterion.passed).toBe(false);
    expect(criterion.value).toBe(0);
    expect(criterion.threshold).toBe(MIN_CONCORDANT_PAIRS);
  });

  it('fires on a flat table, where no pair differs at all', () => {
    // Null concordance is a flat table -- exactly what "not declining" describes
    // -- so it must FAIL rather than pass for want of evidence against it.
    const table = bins([
      { visits: 100, rate: 0.4 },
      { visits: 100, rate: 0.4 },
      { visits: 100, rate: 0.4 },
    ]);
    const criterion = evaluateRefusals(table, visits(300)).criteria.find(
      (c) => c.code === 'not-declining',
    )!;
    expect(criterion.passed).toBe(false);
    expect(criterion.value).toBeNull();
    expect(criterion.statement).toContain('flat rather than declining');
  });

  it('tolerates one inversion in an otherwise declining table', () => {
    // 5 of 6 pairs decline: 83%, over the 70% bar. The criterion is about the
    // trend, not about every neighbouring pair.
    const table = bins([
      { visits: 100, rate: 0.7 },
      { visits: 100, rate: 0.3 },
      { visits: 100, rate: 0.35 },
      { visits: 100, rate: 0.1 },
    ]);
    const criterion = evaluateRefusals(table, visits(400)).criteria.find(
      (c) => c.code === 'not-declining',
    )!;
    expect(criterion.value).toBeGreaterThanOrEqual(MIN_CONCORDANT_PAIRS);
    expect(criterion.passed).toBe(true);
  });
});

describe('amplitude-below-gate', () => {
  it('fires just under the bar and passes just over it', () => {
    /*
     * The bar is 2.0x and is stated a priori: the highest usable bin measures
     * the spot's tide-independent background, and a distinct low zone must at
     * least double it. These two cases sit either side of it by 5%.
     */
    const under = bins([
      { visits: 100, rate: 0.38 },
      { visits: 100, rate: 0.3 },
      { visits: 100, rate: 0.2 },
    ]);
    const over = bins([
      { visits: 100, rate: 0.42 },
      { visits: 100, rate: 0.3 },
      { visits: 100, rate: 0.2 },
    ]);

    const underCriterion = evaluateRefusals(under, visits(300)).criteria.find(
      (c) => c.code === 'amplitude-below-gate',
    )!;
    expect(underCriterion.value).toBeCloseTo(1.9, 6);
    expect(underCriterion.passed).toBe(false);
    expect(underCriterion.threshold).toBe(MIN_AMPLITUDE_RATIO);

    expect(
      evaluateRefusals(over, visits(300)).criteria.find((c) => c.code === 'amplitude-below-gate')!
        .passed,
    ).toBe(true);
  });

  it('fires rather than passing on an infinite ratio', () => {
    // A highest bin with no hits gives a ratio over zero. That is a bin with
    // nothing in it, not an infinitely good spot, and it must not clear the
    // strongest gate in the pipeline.
    const table = bins([
      { visits: 100, rate: 0.7 },
      { visits: 100, rate: 0.3 },
      { visits: 100, rate: 0 },
    ]);
    const criterion = evaluateRefusals(table, visits(300)).criteria.find(
      (c) => c.code === 'amplitude-below-gate',
    )!;
    expect(criterion.value).toBeNull();
    expect(criterion.passed).toBe(false);
  });
});

describe('observer-concentration', () => {
  it('fires when one login carries more than the share limit', () => {
    // 200 visits, 100 of them one person's.
    const many = visits(200, 200);
    for (let i = 0; i < 100; i++) many[i]!.observerLogin = 'enthusiast';

    const criterion = evaluateRefusals(CLEAN, many).criteria.find(
      (c) => c.code === 'observer-concentration',
    )!;
    expect(criterion.value).toBeCloseTo(0.5, 6);
    expect(criterion.threshold).toBe(MAX_SINGLE_OBSERVER_SHARE);
    expect(criterion.passed).toBe(false);
    expect(criterion.statement).toContain('One enthusiast is not a distribution');
  });

  it('passes at exactly the limit', () => {
    const many = visits(100, 100);
    for (let i = 0; i < 30; i++) many[i]!.observerLogin = 'enthusiast';
    expect(
      evaluateRefusals(CLEAN, many).criteria.find((c) => c.code === 'observer-concentration')!
        .passed,
    ).toBe(true);
  });
});

describe('the verdict as a whole', () => {
  it('evaluates every criterion even after one has failed', () => {
    const table = bins([{ visits: 5, rate: 0.5 }]);
    const verdict = evaluateRefusals(table, visits(5));

    expect(verdict.criteria).toHaveLength(4);
    // Each carries its own measured value, so a report can show a spot that
    // failed three gates differently from one that failed one.
    for (const criterion of verdict.criteria) {
      expect(criterion.statement.length).toBeGreaterThan(20);
    }
  });

  it('names every failing criterion in the null reason, not just the first', () => {
    const table = bins([
      { visits: 100, rate: 0.2 },
      { visits: 100, rate: 0.6 },
    ]);
    const verdict = evaluateRefusals(table, visits(200));

    expect(verdict.nullReason).toContain('too-few-usable-bins');
    expect(verdict.nullReason).toContain('not-declining');
    expect(verdict.nullReason).toContain('amplitude-below-gate');
  });

  it('never emits a refusal without a reason, or a publication with one', () => {
    for (const table of [CLEAN, bins([{ visits: 3, rate: 1 }])]) {
      const verdict = evaluateRefusals(table, visits(50));
      expect(verdict.publishes).toBe(verdict.nullReason === null);
    }
  });

  it('refuses an empty spot rather than dividing by zero', () => {
    const verdict = evaluateRefusals(bins([]), []);
    expect(verdict.publishes).toBe(false);
    expect(verdict.nullReason).not.toBeNull();
  });
});
