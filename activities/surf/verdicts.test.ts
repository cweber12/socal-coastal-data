/*
 * Every surf verdict, against output captured from `main` before #130 touched
 * anything.
 *
 * The same instrument as `activities/tidepool/verdicts.test.ts`, and its header
 * explains why a committed capture rather than a run. What differs is the
 * matrix, because what varies between surf spots is not what varies between
 * tidepool spots.
 *
 *   24 spots       every surf-zone member on the SHIPPED band and the real NDBC
 *                  reading -- the grid a reader actually gets. What differs per
 *                  spot is the daylight clip and the ceiling
 *   4 of them      the whole matrix: `windansea` on the corridor-default 3.0 ft
 *                  ceiling, `blacks-beach` on its 2.0 ft override,
 *                  `tourmaline` on its 4.0 ft one, and `cabrillo-tidepools`,
 *                  which is the corridor's one gated spot and the only way
 *                  `closed` appears at all
 *   3 bands        the shipped 1.5-3.5 ft, a narrow 4.0-4.6 ft, and an
 *                  unreachable 5.6-6.2 ft. The shipped band is in range almost
 *                  constantly this week and on its own reaches four states of
 *                  eight; the other two are what produce `out-of-band`, `dark`
 *                  and `brief`
 *   7 days         the full grid width, from today out past the swell horizon
 *   4 swells       null, 0.4, 1.1 and 4.2 ft: unknown, under the minimum, the
 *                  real reading, and over the ceiling
 *
 * 476 rows, and every one of the eight states appears in them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { evaluateSurfDay } from './policy';
import { gateWindowFor } from '../../core/spot/access';
import { SPOT_BY_SLUG } from '@/shared/spots.generated';
import { loadCoopsFixture, ZONE } from '../../core/window/__testing__/series';

interface GoldenRow {
  in: {
    spot: string;
    date: string;
    band: [number, number];
    ceilingFt: number;
    minimumFt: number;
    swellFt: number | null;
  };
  out: Record<string, unknown>;
}

const GOLDEN: GoldenRow[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/verdicts-20260727.json', import.meta.url)), 'utf8'),
);

const series = loadCoopsFixture('coops-9410230-20260727-240h.json');

/** 2026-07-27 08:00 PDT. Day 0 is today; days 5 and 6 are past the swell horizon. */
const NOW_MS = Date.parse('2026-07-27T15:00:00Z');

const r6 = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Number(n.toFixed(6));

const parseDate = (ymd: string) => {
  const [year, month, day] = ymd.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};

/**
 * Replay one captured row and flatten the result the way the pre-refactor type
 * was shaped.
 *
 * `sessions` was a field on `SurfDay` and is now `windows` on the shared shape;
 * `best`, `dayLowFt`, `dayHighFt` and the day's extrema moved into `detail`.
 * Every value is read back out here under the name it had, so a value that moved
 * still compares and a value that CHANGED fails.
 */
function replay(row: GoldenRow) {
  const spot = SPOT_BY_SLUG[row.in.spot as keyof typeof SPOT_BY_SLUG]!;
  const date = parseDate(row.in.date);
  const day = evaluateSurfDay({
    series,
    date,
    band: { minFt: row.in.band[0], maxFt: row.in.band[1] },
    swellCeilingFt: row.in.ceilingFt,
    swellMinimumFt: row.in.minimumFt,
    currentSwellFt: row.in.swellFt,
    nowMs: NOW_MS,
    lat: spot.lat,
    lon: spot.lon,
    timeZone: ZONE,
    gate: gateWindowFor(row.in.spot, date, ZONE),
  });

  return {
    state: day.state,
    reason: day.reason,
    isToday: day.isToday,
    daysFromToday: day.daysFromToday,
    dayLowFt: r6(day.detail.dayLowFt),
    dayHighFt: r6(day.detail.dayHighFt),
    extremaCount: day.detail.extrema.length,
    sessions: day.windows.map((s) => [
      s.startMs,
      s.endMs,
      s.continuesBefore,
      s.continuesAfter,
      s.seriesClipped,
      s.anchors.map((a) => [a.kind, a.tMs, r6(a.ft)]),
      s.usableStartMs,
      s.usableEndMs,
      r6(s.usableMinutes),
      r6(s.minutesRemaining),
      s.gateBlocked,
    ]),
    bestIndex: day.detail.best === null ? null : day.windows.indexOf(day.detail.best),
    sunriseMs: day.sunriseMs,
    sunsetMs: day.sunsetMs,
    swellFt: r6(day.swellFt),
    swellKnown: day.swellKnown,
  };
}

describe('the captured grid', () => {
  it('is 476 rows covering all eight states', () => {
    // Guards the capture, not the predicate. A fixture that quietly shrank would
    // make every assertion below weaker without failing one of them.
    expect(GOLDEN).toHaveLength(476);
    const states = new Set(GOLDEN.map((r) => r.out.state));
    expect([...states].sort()).toEqual([
      'brief',
      'closed',
      'dark',
      'flat',
      'go',
      'out-of-band',
      'swell-tbd',
      'veto',
    ]);
  });

  it('reproduces every field of every row, including every session boundary', () => {
    const replayed = GOLDEN.map(replay);
    expect(replayed).toEqual(GOLDEN.map((r) => r.out));
  });

  it('reproduces every reason string exactly', () => {
    for (const row of GOLDEN) {
      expect(
        replay(row).reason,
        `${row.in.spot} ${row.in.date} band=${row.in.band.join('-')} swell=${row.in.swellFt}`,
      ).toBe(row.out.reason);
    }
  });
});
