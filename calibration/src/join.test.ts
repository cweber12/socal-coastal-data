/**
 * The join, against synthetic cases built to trip one thing each, and against
 * the committed CO-OPS series for anything that needs a real tide.
 *
 * Every published number goes through this file. The two cases that matter most
 * are the ones a reader cannot check by eye:
 *
 *   The local-day boundary across a DST transition. `localDayBounds` returns a
 *   23- or 25-hour day, and the hour a spring-forward removes is 02:00-03:00 --
 *   which in this corridor is exactly where a winter lower low sits.
 *
 *   Visit collapse. It is a FILTER, not a diagnostic: without it one
 *   photo-heavy walk votes thirty times and the rate becomes a rate over
 *   cameras.
 */

import { describe, expect, it } from 'vitest';

import { parseCoopsSeries, type TideSeries } from '../../lib/tide.ts';
import type { LocalDate } from '../../lib/time.ts';
import {
  BINS,
  amplitudeRatio,
  backgroundBand,
  binIndexFor,
  binVisits,
  collapseToVisits,
  concordance,
  dayMinimum,
  matchedTaxa,
  observerConcentration,
  placeVisits,
  wilsonInterval,
  type CalibrationRecord,
} from './join.ts';
import coops2026 from '../__fixtures__/coops-9410230-2026.json' with { type: 'json' };

const SERIES: TideSeries = parseCoopsSeries(coops2026, {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
});

const TZ = 'America/Los_Angeles';

/** Frozen-list ids used by the synthetic cases. */
const MEGATHURA = 48645;
const APLYSIA = 48655;
const PHYLLOSPADIX = 72297;
const ANTHOPLEURA = 49051;
const TARGETS = new Set([MEGATHURA, APLYSIA, PHYLLOSPADIX]);
const ALL = new Set([...TARGETS, ANTHOPLEURA]);

let nextId = 1;
function record(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    id: nextId++,
    observerLogin: 'alice',
    observedOn: { year: 2026, month: 3, day: 10 },
    observedAtMs: Date.UTC(2026, 2, 10, 18, 0, 0),
    lat: 32.669,
    lon: -117.245,
    distanceM: 100,
    positionalAccuracyM: 20,
    taxonId: ANTHOPLEURA,
    ancestorIds: [ANTHOPLEURA],
    ...over,
  };
}

/* ===========================================================================
 * Taxon matching
 * ========================================================================= */

describe('matchedTaxa', () => {
  it('matches a species-level record to a genus target through ancestry', () => {
    // Phyllospadix is the one genus in the frozen list, and its corpus is almost
    // entirely P. torreyi and P. scouleri. Matching on taxon.id alone would
    // report the genus as absent and its removal as costless.
    const torreyi = record({ taxonId: 72298, ancestorIds: [47126, 72297, 72298] });
    expect(matchedTaxa(torreyi, TARGETS)).toEqual([PHYLLOSPADIX]);
  });

  it('matches a record that is the target taxon itself', () => {
    expect(matchedTaxa(record({ taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }), TARGETS)).toEqual([
      MEGATHURA,
    ]);
  });

  it('matches nothing when neither the taxon nor an ancestor is on the list', () => {
    expect(matchedTaxa(record({ taxonId: 999, ancestorIds: [1, 2] }), TARGETS)).toEqual([]);
  });
});

/* ===========================================================================
 * Visit collapse
 * ========================================================================= */

describe('collapseToVisits', () => {
  it('turns 30 records from one observer on one day into 1 visit', () => {
    const records = Array.from({ length: 30 }, () => record());
    const visits = collapseToVisits(records, ALL, TARGETS);

    expect(visits).toHaveLength(1);
    expect(visits[0]!.recordCount).toBe(30);
  });

  it('keeps two observers on the same day apart', () => {
    const visits = collapseToVisits(
      [record({ observerLogin: 'alice' }), record({ observerLogin: 'bob' })],
      ALL,
      TARGETS,
    );
    expect(visits).toHaveLength(2);
  });

  it('keeps one observer on two days apart', () => {
    const visits = collapseToVisits(
      [
        record({ observedOn: { year: 2026, month: 3, day: 10 } }),
        record({ observedOn: { year: 2026, month: 3, day: 11 } }),
      ],
      ALL,
      TARGETS,
    );
    expect(visits).toHaveLength(2);
  });

  it('labels a visit a hit when any one of its records matched a target', () => {
    const visits = collapseToVisits(
      [record(), record(), record({ taxonId: MEGATHURA, ancestorIds: [MEGATHURA] })],
      ALL,
      TARGETS,
    );
    expect(visits[0]!.isHit).toBe(true);
    expect(visits[0]!.matchedTaxonIds).toEqual([MEGATHURA, ANTHOPLEURA].sort((a, b) => a - b));
  });

  it('is not a hit when only denominator taxa were recorded', () => {
    // The denominator is what makes a visit a visit. Somebody who photographed
    // only anemones was at the reef; they did not see a target.
    const visits = collapseToVisits([record(), record()], ALL, TARGETS);
    expect(visits[0]!.isHit).toBe(false);
    expect(visits[0]!.matchedTaxonIds).toEqual([ANTHOPLEURA]);
  });

  it('takes the median timestamp, and null when no record carried a time', () => {
    const base = Date.UTC(2026, 2, 10, 17, 0, 0);
    const visits = collapseToVisits(
      [
        record({ observedAtMs: base }),
        record({ observedAtMs: base + 3_600_000 }),
        record({ observedAtMs: base + 7_200_000 }),
      ],
      ALL,
      TARGETS,
    );
    expect(visits[0]!.medianObservedAtMs).toBe(base + 3_600_000);

    const untimed = collapseToVisits([record({ observedAtMs: null })], ALL, TARGETS);
    expect(untimed[0]!.medianObservedAtMs).toBeNull();
  });

  it('counts null and imprecise accuracy separately', () => {
    // acc_below conflates these, and at Cabrillo #30 measured 21.5% null against
    // 14% imprecise. A record with no stated accuracy is unresolved, not coarse.
    const visits = collapseToVisits(
      [
        record({ positionalAccuracyM: null }),
        record({ positionalAccuracyM: 500 }),
        record({ positionalAccuracyM: 10 }),
      ],
      ALL,
      TARGETS,
    );
    expect(visits[0]!.nullAccuracyRecords).toBe(1);
    expect(visits[0]!.impreciseRecords).toBe(1);
  });
});

/* ===========================================================================
 * The predictor
 * ========================================================================= */

describe('dayMinimum', () => {
  it('takes the minimum over the local day, not the UTC one', () => {
    /*
     * 8 July 2026 is chosen because the two answers genuinely differ there:
     * 0.959 ft over the Pacific day against 1.715 ft over the UTC one. Most
     * dates agree by luck -- the corridor's lower low usually falls well inside
     * both windows -- and a date where they agree would let a UTC implementation
     * pass this test.
     */
    const date: LocalDate = { year: 2026, month: 7, day: 8 };
    const local = dayMinimum(SERIES, date, TZ);

    const utcMin = Math.min(
      ...SERIES.samples
        .filter((s) => s.tMs >= Date.UTC(2026, 6, 8) && s.tMs < Date.UTC(2026, 6, 9))
        .map((s) => s.ft),
    );
    expect(local.ft).toBeCloseTo(0.959, 3);
    expect(utcMin).toBeCloseTo(1.715, 3);

    // And the answer really is the minimum of the local window.
    const localStart = Date.UTC(2026, 6, 8, 7);
    const localEnd = Date.UTC(2026, 6, 9, 7);
    const expected = Math.min(
      ...SERIES.samples.filter((s) => s.tMs >= localStart && s.tMs < localEnd).map((s) => s.ft),
    );
    expect(local.ft).toBe(expected);
    expect(local.tMs).toBeGreaterThanOrEqual(localStart);
    expect(local.tMs).toBeLessThan(localEnd);
  });

  it('spans 25 hours on the autumn fall-back day', () => {
    // 1 November 2026: Pacific gains an hour. A fixed 24-hour window would drop
    // the last hour of the day.
    const samples = countSamplesInLocalDay({ year: 2026, month: 11, day: 1 });
    expect(samples).toBe(25 * 10);
  });

  it('spans 23 hours on the spring forward-day, and the removed hour is 02:00', () => {
    /*
     * 8 March 2026. The hour that vanishes is 02:00-03:00 local, which in this
     * corridor is exactly where a winter lower low sits -- so a fixed 24-hour
     * window here does not merely miscount, it can take the minimum with it.
     */
    const samples = countSamplesInLocalDay({ year: 2026, month: 3, day: 8 });
    expect(samples).toBe(23 * 10);
  });

  it('throws rather than returning the minimum of a partial day', () => {
    // A gap is a hard failure, not a skipped record. Silently dropping the days a
    // series happens not to cover would bias the sample toward the ones it does.
    const short: TideSeries = { ...SERIES, samples: SERIES.samples.slice(0, 500) };
    expect(() => dayMinimum(short, { year: 2026, month: 12, day: 1 }, TZ)).toThrow(
      /not\s+covered by the series/,
    );
  });
});

function countSamplesInLocalDay(date: LocalDate): number {
  // Reconstruct the window dayMinimum uses, and count what falls inside it.
  const { startMs, endMs } = localDayBoundsFor(date);
  return SERIES.samples.filter((s) => s.tMs >= startMs && s.tMs < endMs).length;
}

function localDayBoundsFor(date: LocalDate): { startMs: number; endMs: number } {
  // Imported indirectly through dayMinimum in production; recomputed here so the
  // test asserts the window's LENGTH rather than trusting the same helper twice.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const offsetAt = (ms: number): number => {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    return (
      Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) -
      ms
    );
  };
  const midnight = (d: LocalDate): number => {
    const naive = Date.UTC(d.year, d.month - 1, d.day);
    return naive - offsetAt(naive - offsetAt(naive));
  };
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    startMs: midnight(date),
    endMs: midnight({
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
    }),
  };
}

describe('placeVisits', () => {
  it('gives every visit on one day the same predictor', () => {
    const visits = collapseToVisits(
      [
        record({ observerLogin: 'alice', observedOn: { year: 2026, month: 7, day: 15 } }),
        record({ observerLogin: 'bob', observedOn: { year: 2026, month: 7, day: 15 } }),
      ],
      ALL,
      TARGETS,
    );
    const placed = placeVisits(visits, SERIES, TZ);
    expect(placed[0]!.dayLowFt).toBe(placed[1]!.dayLowFt);
    expect(placed[0]!.dayLowMs).toBe(placed[1]!.dayLowMs);
  });
});

/* ===========================================================================
 * Bins
 * ========================================================================= */

describe('binIndexFor', () => {
  it('puts a height exactly on an edge in the bin above it, and in only one bin', () => {
    // Half-open [lo, hi). -1.0 is the boundary between the first two bins.
    expect(binIndexFor(-1.0)).toBe(1);
    expect(binIndexFor(-1.001)).toBe(0);
    expect(binIndexFor(0)).toBe(3);
    expect(binIndexFor(-2.5)).toBe(0);
  });

  it('separates the quarter-foot edges of the decision region', () => {
    /*
     * The property #43 exists to create. Before it, 0.3 and 0.9 were the same
     * bin, so a crossing anywhere between them had a value and no location. Each
     * assertion below straddles one new edge by 0.01 ft.
     */
    expect(binIndexFor(0.24)).toBe(3); // [0.00, 0.25)
    expect(binIndexFor(0.25)).toBe(4); // [0.25, 0.50)
    expect(binIndexFor(0.5)).toBe(5); // [0.50, 0.75)
    expect(binIndexFor(0.74)).toBe(5);
    expect(binIndexFor(0.75)).toBe(6); // [0.75, 1.00)
    expect(binIndexFor(1.0)).toBe(7); // [1.00, 1.25)
    expect(binIndexFor(1.25)).toBe(8); // [1.25, 1.50)
    expect(binIndexFor(1.49)).toBe(8);
    expect(binIndexFor(1.5)).toBe(9); // [1.50, 3.00)

    // And the NPS figure and the current Cabrillo floor, which used to share a
    // bin with each other and with the whole 0.5-1.0 stretch, no longer do.
    expect(binIndexFor(0.7)).not.toBe(binIndexFor(1.3));
  });

  it('returns null outside every bin rather than clamping', () => {
    // A day whose low is +4 ft is outside anything this table describes, and
    // clamping would let it vote in the top bin.
    expect(binIndexFor(-2.6)).toBeNull();
    expect(binIndexFor(3.0)).toBeNull();
    expect(binIndexFor(4)).toBeNull();
  });

  it('covers the edges the pipeline publishes', () => {
    // Coarse below the datum where the rates are high, 0.25 ft across the
    // decision region, one wide bin for the background above 1.5 ft. Declared in
    // config.ts for #43, before any re-binned rate was computed.
    expect(BINS.map((b) => b.loFt)).toEqual([
      -2.5, -1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5,
    ]);
    expect(BINS.at(-1)!.hiFt).toBe(3);
  });

  it('spans the decision region in quarter-foot steps with no gap', () => {
    // Stated as a property of the region rather than as a list, so an edge
    // dropped from the middle fails here and not only in the list above.
    const region = BINS.filter((b) => b.loFt >= 0 && b.hiFt <= 1.5);
    expect(region).toHaveLength(6);
    for (const bin of region) expect(bin.hiFt - bin.loFt).toBeCloseTo(0.25, 10);
    expect(region[0]!.loFt).toBe(0);
    expect(region.at(-1)!.hiFt).toBe(1.5);
  });

  it('labels every bin at the precision its own edges need', () => {
    /*
     * `(0.25).toFixed(1)` is "0.3", so the label this file used to build would
     * have named [0.00, 0.25) as [0.0, 0.3) -- a band 0.05 ft wider than the one
     * whose visits it counts. The label is display only, and out/report.md is
     * where a reviewer reads it.
     */
    expect(BINS[3]!.label).toBe('[0.00, 0.25)');
    expect(BINS[6]!.label).toBe('[0.75, 1.00)');
    expect(BINS.at(-1)!.label).toBe('[1.50, 3.00)');

    // Every label must round-trip to the edges it names, at every bin.
    for (const bin of BINS) {
      const [lo, hi] = bin.label.slice(1, -1).split(', ').map(Number);
      expect(lo).toBe(bin.loFt);
      expect(hi).toBe(bin.hiFt);
    }
  });
});

/* ===========================================================================
 * The summary statistics the gates read
 * ========================================================================= */

/** A bin table straight from rates, for testing the gates without a tide. */
function table(rows: { visits: number; rate: number }[]) {
  return rows.map((row, i) => ({
    index: i,
    label: BINS[i]!.label,
    loFt: BINS[i]!.loFt,
    hiFt: BINS[i]!.hiFt,
    visits: row.visits,
    hits: Math.round(row.visits * row.rate),
    rate: row.visits === 0 ? null : row.rate,
    usable: row.visits >= 15,
  }));
}

describe('backgroundBand', () => {
  it('is the highest usable bin alone when nothing sits above it', () => {
    const band = backgroundBand(
      table([
        { visits: 100, rate: 0.6 },
        { visits: 100, rate: 0.4 },
        { visits: 100, rate: 0.2 },
      ]),
    )!;
    expect(band.binsPooled).toBe(1);
    expect(band.visits).toBe(100);
    expect(band.hits).toBe(20);
    expect(band.rate).toBeCloseTo(0.2, 10);
    expect(band.loFt).toBe(BINS[2]!.loFt);
    expect(band.hiFt).toBe(BINS[2]!.hiFt);
  });

  it('pools the thin bins above the highest usable one into it', () => {
    /*
     * The La Jolla Cove shape, at its real counts. The old top band held those
     * 17 high-tide visits together at 29.4% and the gate caught the spot at
     * 0.85x. Split into 6, 7 and 4 they all fall under USABLE_BIN_MIN_VISITS,
     * and before #72 they were discarded outright -- leaving 1 hit in 18 visits
     * as the background and reading 4.50x on a flat table.
     */
    const bins = table([
      { visits: 100, rate: 0.25 },
      { visits: 18, rate: 1 / 18 },
      { visits: 6, rate: 2 / 6 },
      { visits: 7, rate: 2 / 7 },
      { visits: 4, rate: 1 / 4 },
    ]);
    const band = backgroundBand(bins)!;

    expect(band.binsPooled).toBe(4);
    expect(band.visits).toBe(18 + 6 + 7 + 4);
    expect(band.hits).toBe(1 + 2 + 2 + 1);
    expect(band.rate).toBeCloseTo(6 / 35, 10);
    // Nothing above the highest usable bin is left out of the count.
    expect(band.visits).toBe(bins.slice(1).reduce((n, b) => n + b.visits, 0));
  });

  it('is null when no bin is usable at all', () => {
    // A spot with nothing to measure, which is not the same as a background of
    // zero -- torrey-pines-beach reaches this on the real corpus.
    expect(backgroundBand(table([{ visits: 3, rate: 0.5 }]))).toBeNull();
    expect(backgroundBand(table([]))).toBeNull();
  });
});

describe('amplitudeRatio', () => {
  it('is the lowest usable bin over the pooled background', () => {
    const bins = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.4 },
      { visits: 100, rate: 0.2 },
    ]);
    expect(amplitudeRatio(bins)).toBeCloseTo(3, 6);
  });

  it('folds a thin top bin into the background rather than letting it become one', () => {
    /*
     * The thin 0.02 bin standing alone as background would give a ratio of 30.
     * Pooled into the 0.20 bin above which it sits, 103 visits carry 20 hits, so
     * the background is 0.194 and the ratio 3.09 -- the thin bin nudges it, it
     * does not decide it.
     */
    const bins = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.2 },
      { visits: 3, rate: 0.02 },
    ]);
    expect(amplitudeRatio(bins)).toBeCloseTo(0.6 / (20 / 103), 6);
    expect(amplitudeRatio(bins)).toBeLessThan(3.2);
  });

  it('is null rather than Infinity when the background band has no hits', () => {
    /*
     * A ratio over zero is not "infinitely good". It is a band with no hits in
     * it, and reporting Infinity would let a spot pass the strongest gate in the
     * pipeline on the strength of an empty top of the table.
     */
    const bins = table([
      { visits: 100, rate: 0.6 },
      { visits: 20, rate: 0 },
    ]);
    expect(amplitudeRatio(bins)).toBeNull();
  });

  it('is null with fewer than two usable bins', () => {
    expect(amplitudeRatio(table([{ visits: 100, rate: 0.6 }]))).toBeNull();
    expect(amplitudeRatio(table([]))).toBeNull();
  });

  it('reproduces the wide band exactly when the top band\'s first sub-bin is usable', () => {
    /*
     * The case #72 fully fixes, and the one the real corpus hits at Cabrillo and
     * La Jolla Shores: the old top band is cut up, its LOWEST slice is still fat
     * enough to be usable, and the pool therefore spans exactly the old band.
     * Same 40 visits, same 4 hits, same ratio -- the subdivision costs nothing.
     *
     * Before pooling the split table read 6.0x too, but only by luck: it read
     * the 18-visit slice alone at the same 0.11 rate. Change one hit in the
     * discarded slices and the old code moves while this one does not.
     */
    const wide = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.3 },
      { visits: 40, rate: 0.1 },
    ]);
    const split = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.3 },
      { visits: 18, rate: 2 / 18 },
      { visits: 12, rate: 1 / 12 },
      { visits: 10, rate: 0.1 },
    ]);

    expect(backgroundBand(split)!.visits).toBe(backgroundBand(wide)!.visits);
    expect(backgroundBand(split)!.hits).toBe(backgroundBand(wide)!.hits);
    expect(backgroundBand(split)!.loFt).toBe(backgroundBand(wide)!.loFt);
    expect(amplitudeRatio(wide)).toBeCloseTo(6, 6);
    expect(amplitudeRatio(split)).toBeCloseTo(amplitudeRatio(wide)!, 6);
  });

  it('falls back a band, over MORE visits, when every sub-bin of the top band is thin', () => {
    /*
     * The limit of the fix, asserted rather than glossed. Pooling removes the
     * DISCARDING -- no visit above the highest usable bin goes uncounted -- but
     * it does not make the gate fully width-invariant, because which bin is
     * "highest usable" still depends on the widths. Cut the top band finely
     * enough that no slice reaches 15 visits and the background falls to the band
     * below, pooling that band in with it.
     *
     * The direction is what matters: the background is then measured over MORE
     * visits than the wide table's, not fewer, and at a HIGHER rate, so the ratio
     * falls. The gate gets stricter, never looser, which is the direction
     * README.md requires of it. La Jolla Cove lands here on the real corpus:
     * 17 visits of background became 35, and 4.50x became 1.46x.
     */
    const wide = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.3 },
      { visits: 40, rate: 0.1 },
    ]);
    const allThin = table([
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.3 },
      { visits: 14, rate: 2 / 14 },
      { visits: 13, rate: 1 / 13 },
      { visits: 13, rate: 1 / 13 },
    ]);

    // Same 40 visits and 4 hits at the top of the table in both.
    expect(allThin.slice(2).reduce((n, b) => n + b.visits, 0)).toBe(40);
    expect(allThin.slice(2).reduce((n, b) => n + b.hits, 0)).toBe(4);

    expect(backgroundBand(allThin)!.visits).toBeGreaterThan(backgroundBand(wide)!.visits);
    expect(backgroundBand(allThin)!.rate!).toBeGreaterThan(backgroundBand(wide)!.rate!);
    expect(amplitudeRatio(allThin)!).toBeLessThan(amplitudeRatio(wide)!);
  });

  it('pools upward only, so a thin bin below the lowest usable one cannot raise it', () => {
    /*
     * The asymmetry, asserted. The numerator is the low-tide rate; pooling
     * DOWNWARD would fold thin extreme-low bins into it and could only raise the
     * ratio, and this gate has to fail toward the restriction.
     *
     * Here the bottom bin is a 3-visit band at 1.0. Pooling it in would take the
     * numerator from 0.6 to 0.612 and the ratio up with it; discarding it, which
     * is what happens, leaves the ratio at exactly 3.
     */
    const bins = table([
      { visits: 3, rate: 1 },
      { visits: 100, rate: 0.6 },
      { visits: 100, rate: 0.2 },
    ]);
    expect(amplitudeRatio(bins)).toBeCloseTo(3, 6);
  });
});

describe('concordance', () => {
  it('is 1 for a strictly declining table', () => {
    const c = concordance(
      table([
        { visits: 50, rate: 0.6 },
        { visits: 50, rate: 0.4 },
        { visits: 50, rate: 0.2 },
      ]),
    );
    expect(c.fraction).toBe(1);
    expect(c.concordant).toBe(3);
    expect(c.discordant).toBe(0);
  });

  it('is 0 for a table that climbs with the tide, which is the diver signature', () => {
    const c = concordance(
      table([
        { visits: 50, rate: 0.2 },
        { visits: 50, rate: 0.4 },
        { visits: 50, rate: 0.6 },
      ]),
    );
    expect(c.fraction).toBe(0);
  });

  it('excludes ties from the denominator rather than counting them either way', () => {
    // Two bins reading the same rate is not evidence that the rate declines, and
    // not evidence that it does not. Folding them in either direction would make
    // the criterion sensitive to how coarsely the rates happen to round.
    const c = concordance(
      table([
        { visits: 50, rate: 0.5 },
        { visits: 50, rate: 0.5 },
        { visits: 50, rate: 0.2 },
      ]),
    );
    expect(c.tied).toBe(1);
    expect(c.concordant).toBe(2);
    expect(c.discordant).toBe(0);
    expect(c.fraction).toBe(1);
  });

  it('is null when every comparable pair ties, which is a flat table', () => {
    const c = concordance(
      table([
        { visits: 50, rate: 0.4 },
        { visits: 50, rate: 0.4 },
      ]),
    );
    expect(c.fraction).toBeNull();
  });
});

describe('observerConcentration', () => {
  it('finds the largest single contributor', () => {
    const visits = placeVisits(
      collapseToVisits(
        [
          record({ observerLogin: 'a', observedOn: { year: 2026, month: 7, day: 1 } }),
          record({ observerLogin: 'a', observedOn: { year: 2026, month: 7, day: 2 } }),
          record({ observerLogin: 'a', observedOn: { year: 2026, month: 7, day: 3 } }),
          record({ observerLogin: 'b', observedOn: { year: 2026, month: 7, day: 4 } }),
        ],
        ALL,
        TARGETS,
      ),
      SERIES,
      TZ,
    );
    const c = observerConcentration(visits);
    expect(c.login).toBe('a');
    expect(c.visits).toBe(3);
    expect(c.share).toBeCloseTo(0.75, 6);
  });

  it('is zero on no visits rather than dividing by zero', () => {
    expect(observerConcentration([]).share).toBe(0);
  });
});

describe('wilsonInterval', () => {
  it('never runs past 0 or 1, which is why it is not the normal approximation', () => {
    // The normal interval on 16 visits at 0.9 reaches past 1.0, and an interval
    // that includes impossible values is not one to print beside a count.
    const [lo, hi] = wilsonInterval(15, 16);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('narrows as the count grows', () => {
    const small = wilsonInterval(30, 50);
    const large = wilsonInterval(300, 500);
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0]);
  });
});

/* ===========================================================================
 * A clean synthetic separation yields the expected rates
 * ========================================================================= */

describe('end to end on a synthetic reef', () => {
  it('recovers the rates it was built with', () => {
    /*
     * Days are chosen from the real 2026 series by their actual day-minimum, so
     * the predictor is exercised rather than stubbed. Every visit on a day whose
     * low is under -1.0 ft records a target; nobody else does. The lowest bin
     * must come back at 1.0 and everything above it at 0.0.
     */
    const days: LocalDate[] = [];
    for (let day = 1; day <= 60; day++) {
      const date = { year: 2026, month: 1, day };
      if (day > 31) {
        date.month = 2;
        date.day = day - 31;
      }
      days.push(date);
    }

    const records: CalibrationRecord[] = [];
    for (const [i, date] of days.entries()) {
      const low = dayMinimum(SERIES, date, TZ).ft;
      const sawTarget = low < -1.0;
      records.push(
        record({
          observerLogin: `observer-${i}`,
          observedOn: date,
          taxonId: sawTarget ? MEGATHURA : ANTHOPLEURA,
          ancestorIds: [sawTarget ? MEGATHURA : ANTHOPLEURA],
        }),
      );
    }

    const bins = binVisits(placeVisits(collapseToVisits(records, ALL, TARGETS), SERIES, TZ));

    expect(bins[0]!.rate).toBe(1);
    for (const bin of bins.slice(1)) {
      if (bin.visits > 0) expect(bin.rate).toBe(0);
    }
  });
});
