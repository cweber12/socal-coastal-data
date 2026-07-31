import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  crossings,
  findExtrema,
  heightAt,
  parseCoopsExtrema,
  parseCoopsSeries,
  sliceSeries,
  type CoopsRequestContract,
  type TideSeries,
} from './coops-predictions';
import { localDateInZone, localDaysBetween, sameLocalDate } from '../time';
import { daylightBounds } from '../spot/daylight';

/* ---------------------------------------------------------------------------
 * Fixtures: real payloads, captured 2026-07-27 from
 * api.tidesandcurrents.noaa.gov with time_zone=gmt, units=english, datum=MLLW,
 * station 9410230, begin_date=20260727, range=72.
 *
 * Captured rather than hand-written on purpose. A hand-written fixture encodes
 * what I believe the endpoint returns, and this repo exists because that belief
 * is where the bugs live.
 * ------------------------------------------------------------------------- */

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8'),
  );

const SIX_MIN_PAYLOAD = fixture('coops-9410230-20260727-6min.json');
const HILO_PAYLOAD = fixture('coops-9410230-20260727-hilo.json');

const CONTRACT: CoopsRequestContract = {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
};

const iso = (ms: number) => new Date(ms).toISOString();

/* =========================================================================
 * Parsing the contract
 * ======================================================================= */

describe('parseCoopsSeries: the request contract', () => {
  it('parses the captured 72-hour 6-minute series', () => {
    const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);

    expect(series.samples).toHaveLength(721); // 72 h at 6 min, inclusive of both ends
    expect(series.stationId).toBe('9410230');
    expect(series.datum).toBe('MLLW');
    expect(series.units).toBe('ft');
    expect(series.timeZone).toBe('UTC');
    expect(series.uniformStepMs).toBe(6 * 60_000);
  });

  it('reads the first sample as UTC, not as Pacific wall time', () => {
    const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);

    // The payload's first row is {"t":"2026-07-27 00:00","v":"4.314"}. Under a
    // gmt contract that is midnight UTC. The bug this guards is reading the same
    // digits as Pacific, which would place it at 07:00Z and age everything 7 h.
    expect(iso(series.samples[0]!.tMs)).toBe('2026-07-27T00:00:00.000Z');
    expect(series.samples[0]!.ft).toBeCloseTo(4.314, 6);

    expect(iso(series.samples[720]!.tMs)).toBe('2026-07-30T00:00:00.000Z');
  });

  it("refuses any time_zone but 'gmt', because the timestamps carry no offset", () => {
    expect(() =>
      parseCoopsSeries(SIX_MIN_PAYLOAD, {
        ...CONTRACT,
        timeZone: 'lst_ldt' as unknown as 'gmt',
      }),
    ).toThrow(/time_zone must be 'gmt'/);
  });

  it('refuses metric units, which would be read as feet and understate 3.28x', () => {
    expect(() =>
      parseCoopsSeries(SIX_MIN_PAYLOAD, {
        ...CONTRACT,
        units: 'metric' as unknown as 'english',
      }),
    ).toThrow(/units must be 'english'/);
  });

  it('refuses an unstated datum, since heights are meaningless without one', () => {
    expect(() => parseCoopsSeries(SIX_MIN_PAYLOAD, { ...CONTRACT, datum: '' })).toThrow(
      /datum must be stated/,
    );
  });
});

describe('parseCoopsSeries: dead and drifted responses', () => {
  it('throws on the 200-with-an-error-body case', () => {
    // Verbatim from the endpoint on datum=NOPE, served with HTTP 200.
    const payload = {
      error: { message: 'No Predictions data was found. Please make sure the Datum input is valid.' },
    };
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/Datum input is valid/);
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/HTTP 200/);
  });

  it('throws on an empty predictions array rather than reporting a flat tide', () => {
    expect(() => parseCoopsSeries({ predictions: [] }, CONTRACT)).toThrow(/dead response/);
  });

  it('throws when there is no predictions key at all', () => {
    expect(() => parseCoopsSeries({ data: [] }, CONTRACT)).toThrow(/no 'predictions' array/);
  });

  it('throws on a timestamp shape that has drifted', () => {
    const payload = { predictions: [{ t: '2026-07-27T00:00:00Z', v: '4.314' }] };
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/does not match the pinned/);
  });

  it('throws on a blank height instead of letting Number("") become 0 ft', () => {
    const payload = { predictions: [{ t: '2026-07-27 00:00', v: '' }] };
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/height is blank/);
  });

  it('throws on a height outside any plausible tidal range', () => {
    const payload = { predictions: [{ t: '2026-07-27 00:00', v: '4314' }] };
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/outside any plausible/);
  });

  it('throws when rows go backwards in time', () => {
    const payload = {
      predictions: [
        { t: '2026-07-27 00:06', v: '4.391' },
        { t: '2026-07-27 00:00', v: '4.314' },
      ],
    };
    expect(() => parseCoopsSeries(payload, CONTRACT)).toThrow(/not strictly increasing/);
  });

  it('rejects the hilo product, which is four peaks a day and not a series', () => {
    expect(() => parseCoopsSeries(HILO_PAYLOAD, CONTRACT)).toThrow(/interval=hilo product/);
  });
});

describe('parseCoopsExtrema', () => {
  it('parses the captured hilo product: 4 extrema a day over 3 days', () => {
    const extrema = parseCoopsExtrema(HILO_PAYLOAD, CONTRACT);

    expect(extrema).toHaveLength(12);
    expect(iso(extrema[0]!.tMs)).toBe('2026-07-27T02:56:00.000Z');
    expect(extrema[0]!.kind).toBe('high');
    expect(extrema[0]!.ft).toBeCloseTo(5.805, 6);
    expect(extrema[1]!.kind).toBe('low');
    expect(extrema[1]!.ft).toBeCloseTo(-0.324, 6);
  });

  it('throws on a row with no type, which would make a high indistinguishable from a low', () => {
    const payload = { predictions: [{ t: '2026-07-27 02:56', v: '5.805' }] };
    expect(() => parseCoopsExtrema(payload, CONTRACT)).toThrow(/expected type 'H' or 'L'/);
  });

  it('throws on two consecutive highs, which means rows are missing', () => {
    const payload = {
      predictions: [
        { t: '2026-07-27 02:56', v: '5.805', type: 'H' },
        { t: '2026-07-27 16:58', v: '3.739', type: 'H' },
      ],
    };
    expect(() => parseCoopsExtrema(payload, CONTRACT)).toThrow(/two consecutive highs/);
  });
});

/* =========================================================================
 * findExtrema, checked against NOAA's own answer
 * ======================================================================= */

describe('findExtrema', () => {
  const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);
  const mine = findExtrema(series);
  const noaa = parseCoopsExtrema(HILO_PAYLOAD, CONTRACT);

  it('finds the same count and ordering of extrema as the hilo product', () => {
    // The 6-minute series covers [00:00 27th, 00:00 30th]; the hilo product for
    // the same window has 12 rows. The first and last extrema of the series can
    // fall outside detection if a turn sits at the very edge, so compare the
    // interior by matching, not by index.
    expect(mine.length).toBe(noaa.length);
    expect(mine.map((e) => e.kind)).toEqual(noaa.map((e) => e.kind));
  });

  it('agrees with NOAA on every extremum time to within 90 s', () => {
    // Measured worst case is 60 s and the mean is 18 s. NOAA reports hilo times
    // to the whole minute, so up to 30 s of any drift is their rounding. 90 s is
    // the measured worst plus that reporting resolution -- not a tolerance
    // widened until the suite went green.
    const drifts = mine.map((m, i) => Math.abs(m.tMs - noaa[i]!.tMs) / 1000);
    for (const [i, drift] of drifts.entries()) {
      expect(drift, `extremum ${i} (${iso(mine[i]!.tMs)} vs ${iso(noaa[i]!.tMs)})`).toBeLessThan(90);
    }
    const mean = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    expect(mean, 'mean drift across all 12 extrema').toBeLessThan(30);
  });

  it('agrees with NOAA on every extremum height to within 0.002 ft', () => {
    // Heights are the strong side of this method: worst measured is 0.001 ft,
    // which is the quantisation of the source itself.
    for (const [i, m] of mine.entries()) {
      expect(Math.abs(m.ft - noaa[i]!.ft), `extremum ${i} height`).toBeLessThan(0.002);
    }
  });

  it('is least precise at the flattest turn, which is the shallow higher low', () => {
    // The one 60 s case is the 28 July low at 2.381 ft. Asserting the mechanism
    // rather than just the magnitude: if a future change makes a sharp turn the
    // worst case, something has broken that the tolerance alone would not catch.
    const worst = mine.reduce(
      (acc, m, i) => {
        const drift = Math.abs(m.tMs - noaa[i]!.tMs);
        return drift > acc.drift ? { drift, index: i } : acc;
      },
      { drift: -1, index: -1 },
    );

    const curvatureAt = (tMs: number): number => {
      const s = series.samples;
      let j = 0;
      for (let k = 1; k < s.length - 1; k++) {
        if (Math.abs(s[k]!.tMs - tMs) < Math.abs(s[j]!.tMs - tMs)) j = k;
      }
      const clamped = Math.min(Math.max(j, 1), s.length - 2);
      return Math.abs(s[clamped - 1]!.ft - 2 * s[clamped]!.ft + s[clamped + 1]!.ft);
    };

    const curvatures = mine.map((m) => curvatureAt(m.tMs));
    const worstCurvature = curvatures[worst.index]!;
    expect(worstCurvature, 'the least precise extremum should be the flattest').toBe(
      Math.min(...curvatures),
    );
    // And it is a low, not a high: the corridor's mixed semidiurnal tide has a
    // shallow second low each day that is flatter than any of its highs.
    expect(mine[worst.index]!.kind).toBe('low');
  });

  it('parabolic refinement beats taking the nearest sample', () => {
    // Without refinement the answer is whichever 6-minute sample is lowest, so
    // the error is bounded by half the step. The refinement is only worth its
    // complexity if it is measurably better than that; this asserts it is.
    const nearestSampleDrift = mine.map((m, i) => {
      const nearest = series.samples.reduce((best, s) =>
        Math.abs(s.tMs - noaa[i]!.tMs) < Math.abs(best.tMs - noaa[i]!.tMs) ? s : best,
      );
      return Math.abs(nearest.tMs - noaa[i]!.tMs);
    });
    const refinedDrift = mine.map((m, i) => Math.abs(m.tMs - noaa[i]!.tMs));

    const meanNearest = nearestSampleDrift.reduce((a, b) => a + b, 0) / nearestSampleDrift.length;
    const meanRefined = refinedDrift.reduce((a, b) => a + b, 0) / refinedDrift.length;
    expect(meanRefined).toBeLessThan(meanNearest);
  });

  it('finds a plateau turn at the midpoint of the flat run', () => {
    const flat: TideSeries = {
      ...CONTRACT,
      units: 'ft',
      timeZone: 'UTC',
      uniformStepMs: 6 * 60_000,
      samples: [1.0, 0.5, 0.2, 0.2, 0.2, 0.5, 1.0].map((ft, i) => ({
        tMs: Date.UTC(2026, 6, 27, 0, i * 6),
        ft,
      })),
    };
    const found = findExtrema(flat);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('low');
    expect(found[0]!.ft).toBe(0.2);
    // Run spans samples 2..4, i.e. 00:12 to 00:24; midpoint 00:18.
    expect(iso(found[0]!.tMs)).toBe('2026-07-27T00:18:00.000Z');
  });

  it('finds nothing in a monotonic series', () => {
    const rising: TideSeries = {
      ...CONTRACT,
      units: 'ft',
      timeZone: 'UTC',
      uniformStepMs: 6 * 60_000,
      samples: [0, 1, 2, 3, 4].map((ft, i) => ({ tMs: Date.UTC(2026, 6, 27, 0, i * 6), ft })),
    };
    expect(findExtrema(rising)).toEqual([]);
  });

  it('throws below three samples, where no turn can be identified', () => {
    const tiny: TideSeries = {
      ...CONTRACT,
      units: 'ft',
      timeZone: 'UTC',
      uniformStepMs: null,
      samples: [{ tMs: 0, ft: 1 }, { tMs: 60_000, ft: 2 }],
    };
    expect(() => findExtrema(tiny)).toThrow(/at least 3 samples/);
  });
});

/* =========================================================================
 * Interpolation and crossings
 * ======================================================================= */

describe('heightAt', () => {
  const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);

  it('returns the sample value exactly on a sample', () => {
    expect(heightAt(series, Date.UTC(2026, 6, 27, 0, 0))).toBeCloseTo(4.314, 6);
  });

  it('interpolates linearly between samples', () => {
    // 00:00 is 4.314 and 00:06 is 4.391; the midpoint should be their mean.
    expect(heightAt(series, Date.UTC(2026, 6, 27, 0, 3))).toBeCloseTo((4.314 + 4.391) / 2, 6);
  });

  it('throws outside the series rather than clamping to the end', () => {
    expect(() => heightAt(series, Date.UTC(2026, 6, 26, 23, 59))).toThrow(/outside the series/);
    expect(() => heightAt(series, Date.UTC(2026, 6, 30, 0, 1))).toThrow(/outside the series/);
  });
});

describe('crossings', () => {
  const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);

  it('brackets the 27th low with a falling then a rising crossing of 0 ft', () => {
    const zero = crossings(series, 0);
    // The 27th's low is -0.324 ft at 10:21Z, the only low below 0 ft on that day.
    const falling = zero.filter((c) => c.direction === 'falling');
    const rising = zero.filter((c) => c.direction === 'rising');
    expect(falling.length).toBeGreaterThan(0);
    expect(rising.length).toBe(falling.length);

    const firstFall = falling[0]!;
    const firstRise = rising.find((c) => c.tMs > firstFall.tMs)!;
    expect(firstFall.tMs).toBeLessThan(Date.UTC(2026, 6, 27, 10, 21));
    expect(firstRise.tMs).toBeGreaterThan(Date.UTC(2026, 6, 27, 10, 21));
  });

  it('interpolates the crossing instant, not the nearest sample', () => {
    const line: TideSeries = {
      ...CONTRACT,
      units: 'ft',
      timeZone: 'UTC',
      uniformStepMs: 6 * 60_000,
      samples: [
        { tMs: Date.UTC(2026, 6, 27, 0, 0), ft: 1 },
        { tMs: Date.UTC(2026, 6, 27, 0, 6), ft: -1 },
      ],
    };
    const found = crossings(line, 0);
    expect(found).toHaveLength(1);
    expect(found[0]!.direction).toBe('falling');
    expect(iso(found[0]!.tMs)).toBe('2026-07-27T00:03:00.000Z');
  });

  it('returns nothing for a level the series never reaches', () => {
    expect(crossings(series, 50)).toEqual([]);
    expect(crossings(series, -10)).toEqual([]);
  });
});

describe('sliceSeries', () => {
  const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);

  it('keeps only samples inside the interval and preserves the contract', () => {
    const from = Date.UTC(2026, 6, 28, 0, 0);
    const to = Date.UTC(2026, 6, 29, 0, 0);
    const day = sliceSeries(series, from, to);

    expect(day.samples).toHaveLength(241); // 24 h at 6 min, both ends inclusive
    expect(day.samples[0]!.tMs).toBe(from);
    expect(day.samples[240]!.tMs).toBe(to);
    expect(day.datum).toBe('MLLW');
    expect(day.uniformStepMs).toBe(6 * 60_000);
  });
});
describe('the 27 July low, read end to end', () => {
  it('lands before sunrise, which is the case that must render as dark', () => {
    const series = parseCoopsSeries(SIX_MIN_PAYLOAD, CONTRACT);
    const lows = findExtrema(series).filter((e) => e.kind === 'low');
    const first = lows[0]!;

    const daylight = daylightBounds(32.8669, -117.2571, { year: 2026, month: 7, day: 27 });
    if (daylight.kind !== 'sun-crosses-horizon') throw new Error('unreachable');

    // 10:21Z is 03:21 Pacific; sunrise is 12:58Z, i.e. 05:58 Pacific. The best
    // low of the day is two and a half hours before first light. This is not a
    // contrived case -- it is the corridor's actual tide on the day this was
    // built, and it is why `dark` is a state rather than an edge case.
    expect(first.ft).toBeLessThan(0);
    expect(first.tMs).toBeLessThan(daylight.sunriseMs);
    expect(localDaysBetween(localDateInZone(first.tMs, 'America/Los_Angeles'), {
      year: 2026,
      month: 7,
      day: 27,
    })).toBe(0);
  });
});
