/**
 * The failure policy, at the composition boundary.
 *
 * lib/grid.ts is where the two upstreams meet and where the asymmetry between
 * them is enforced:
 *
 *   Predictions failing is FATAL to the grid. There is nothing to show, so it
 *   comes back as `failure` and `rows` is empty -- and the page renders a named
 *   failure rather than an empty grid, because an empty grid is a claim about
 *   the tide while this is a claim about the connection.
 *
 *   Swell failing is NOT fatal. It becomes a null reading, which the predicate
 *   turns into `swell-tbd`, which can never render as a pass.
 *
 *   A day that will not evaluate is COLLECTED, not thrown. One unevaluable day
 *   must not take out the other 55 cells, and the day comes back null -- an
 *   absence, not a seventh state.
 *
 * Every test stubs global fetch. `nowMs` is pinned to 2026-07-28T07:05Z, which
 * is 00:05 PDT on 28 July and 39 minutes after the newest row in the NDBC
 * fixture, so the swell reads as current rather than stale.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HORIZON_DAYS,
  SERVABLE_DAYS_AFTER,
  SERVABLE_DAYS_BEFORE,
  isServableDate,
  loadGrid,
  loadSpotDay,
  loadSpotWeek,
  servableDateParam,
  sortRows,
  bestGapFt,
  tidepoolSpotBySlug,
  type SpotRow,
} from './grid';
import { addLocalDays } from './time';
import coops240h from './__fixtures__/coops-9410230-20260727-240h.json';
import coops72h from './__fixtures__/coops-9410230-20260727-6min.json';
import { SPOTS_WITHOUT_FLOOR, TIDEPOOL_SPOTS } from '@/shared/spots.generated';
import { readFileSync } from 'node:fs';

const NDBC_FIXTURE = readFileSync(
  new URL('./__fixtures__/ndbc-46254-20260728.txt', import.meta.url),
  'utf8',
);

/** 2026-07-28 00:05 PDT. 39 min after the newest NDBC row. */
const NOW_MS = Date.UTC(2026, 6, 28, 7, 5, 0);
const TODAY = { year: 2026, month: 7, day: 28 };

let fetchMock: ReturnType<typeof vi.fn>;

const jsonReply = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload, text: async () => '' }) as unknown as Response;

const textReply = (body: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }) as unknown as Response;

/**
 * Route by upstream. Predictions and swell fail independently, which is the
 * whole point of the policy, so every test says what each one does.
 */
function route({
  predictions = jsonReply(coops240h),
  swell = textReply(NDBC_FIXTURE),
}: {
  predictions?: Response | Error;
  swell?: Response | Error | ((buoyId: string) => Response);
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('tidesandcurrents')) {
      if (predictions instanceof Error) throw predictions;
      return predictions;
    }
    if (swell instanceof Error) throw swell;
    if (typeof swell === 'function') {
      return swell(/realtime2\/(\d+)\.txt/.exec(url)?.[1] ?? '');
    }
    return swell;
  });
}

const coopsCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('tidesandcurrents')).length;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/* ===========================================================================
 * loadGrid
 * ========================================================================= */

describe('loadGrid', () => {
  it('composes every spot that carries a floor across the horizon', async () => {
    route();

    const grid = await loadGrid(NOW_MS);

    expect(grid.failure).toBeNull();
    expect(grid.rows).toHaveLength(TIDEPOOL_SPOTS.length);
    expect(grid.days).toHaveLength(HORIZON_DAYS);
    expect(grid.today).toEqual(TODAY);
    expect(grid.evaluatedAtMs).toBe(NOW_MS);
    expect(grid.timeZone).toBe('America/Los_Angeles');
    // Geographic order comes from the file, north to south, and is preserved.
    expect(grid.rows[0]!.spot.slug).toBe('swamis');
    expect(grid.rows.at(-1)!.spot.slug).toBe('cabrillo-tidepools');
    // Every day evaluated: the fixture spans the full range loadGrid requests.
    expect(grid.rows.every((r) => r.days.every((d) => d !== null))).toBe(true);
  });

  it('names the spots it left out rather than quietly omitting them', async () => {
    route();

    const grid = await loadGrid(NOW_MS);

    expect(grid.excludedSpotNames).toHaveLength(SPOTS_WITHOUT_FLOOR.length);
    expect(grid.excludedSpotNames.length).toBeGreaterThan(0);
  });

  it('fetches each tide station once however many spots share it', async () => {
    route();

    await loadGrid(NOW_MS);

    // All eight tidepool spots bind 9410230. Eight requests for one series would
    // be eight times the load for the same bytes.
    expect(coopsCalls()).toBe(1);
    const url = new URL(
      fetchMock.mock.calls.find((c) => String(c[0]).includes('tidesandcurrents'))![0] as string,
    );
    expect(url.searchParams.get('station')).toBe('9410230');
    // A day of margin before, two after: a window can open before local midnight
    // and the sub-floor walk needs samples either side of the crossing.
    expect(url.searchParams.get('begin_date')).toBe('20260727');
    expect(url.searchParams.get('range')).toBe('240');
  });

  it('is fatal when predictions fail, and says so instead of showing an empty grid', async () => {
    route({ predictions: new Error('ECONNRESET') });

    const grid = await loadGrid(NOW_MS);

    expect(grid.failure).not.toBeNull();
    expect(grid.failure!.message).toMatch(/ECONNRESET/);
    // The URL travels with the failure so the page can name what it could not reach.
    expect(grid.failure!.url).toContain('station=9410230');
    expect(grid.rows).toEqual([]);
    // The shell survives: an empty rows array must not also lose the context that
    // says which days and which zone this was about.
    expect(grid.days).toHaveLength(HORIZON_DAYS);
    expect(grid.today).toEqual(TODAY);
    expect(grid.excludedSpotNames.length).toBeGreaterThan(0);
  });

  it('is not fatal when every buoy is down, and no day can then read as a pass', async () => {
    route({ swell: textReply('', 404) });

    const grid = await loadGrid(NOW_MS);

    expect(grid.failure).toBeNull();
    expect(grid.rows).toHaveLength(TIDEPOOL_SPOTS.length);

    const states = grid.rows.flatMap((r) => r.days.map((d) => d?.state));
    // Unknown swell is not calm. `go` requires a known reading, and `veto`
    // requires one too -- an unknown can produce neither.
    expect(states).not.toContain('go');
    expect(states).not.toContain('veto');
    expect(states).toContain('swell-tbd');
    expect(grid.rows.every((r) => r.swell.swellFt === null)).toBe(true);
    expect(grid.rows.every((r) => r.usableCount === 0)).toBe(true);
    // And every one of those failures is on the page rather than in a log.
    expect(grid.notices.length).toBeGreaterThan(0);
  });

  it('surfaces an NDBC format change as a drift notice rather than swallowing it', async () => {
    route({ swell: textReply(NDBC_FIXTURE.replace(/\bWVHT\b/, 'WVHZ')) });

    const grid = await loadGrid(NOW_MS);

    const drift = grid.notices.filter((n) => n.severity === 'drift');
    expect(drift.length).toBeGreaterThan(0);
    expect(drift[0]!.message).toMatch(/WVHT/);
    expect(grid.rows.every((r) => r.swell.drift)).toBe(true);
    // Drift degrades to unknown, never to a wrong number.
    expect(grid.rows.every((r) => r.swell.swellFt === null)).toBe(true);
  });

  it('discloses a fallback substitution as a warning naming the buoy', async () => {
    // 46232 serves sunset-cliffs and cabrillo as primary; both fall back to 46258.
    route({ swell: (buoyId) => (buoyId === '46232' ? textReply('', 404) : textReply(NDBC_FIXTURE)) });

    const grid = await loadGrid(NOW_MS);

    const substituted = grid.rows.filter((r) => r.swell.substituted);
    expect(substituted.map((r) => r.spot.slug).sort()).toEqual([
      'cabrillo-tidepools',
      'sunset-cliffs',
    ]);
    expect(substituted.every((r) => r.swell.sourceBuoyId === '46258')).toBe(true);

    const warning = grid.notices.find(
      (n) => n.severity === 'warn' && n.message.includes('fallback buoy 46258'),
    );
    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/geographically\s+distant/);

    // Spots whose primary answered are untouched by the substitution.
    expect(grid.rows.find((r) => r.spot.slug === 'swamis')!.swell.substituted).toBe(false);
  });

  it('collects a day that will not evaluate instead of losing the whole grid', async () => {
    // The 72 h fixture covers only the first local day of the horizon. The other
    // six run off the end of the series, and evaluateWindow throws rather than
    // clamping -- which must arrive as notices, not as an exception.
    route({ predictions: jsonReply(coops72h) });

    const grid = await loadGrid(NOW_MS);

    expect(grid.failure).toBeNull();
    expect(grid.rows).toHaveLength(TIDEPOOL_SPOTS.length);

    for (const row of grid.rows) {
      expect(row.days[0]).not.toBeNull();
      expect(row.days.slice(1).every((d) => d === null)).toBe(true);
    }

    const unevaluated = grid.notices.filter((n) => n.message.includes('could not be evaluated'));
    expect(unevaluated).toHaveLength(TIDEPOOL_SPOTS.length * (HORIZON_DAYS - 1));
    expect(unevaluated[0]!.severity).toBe('warn');
    expect(unevaluated[0]!.message).toMatch(/does not cover/);
  });
});

/* ===========================================================================
 * Slug resolution
 * ========================================================================= */

describe('tidepoolSpotBySlug', () => {
  it('resolves a spot the grid can evaluate', () => {
    const spot = tidepoolSpotBySlug('cabrillo-tidepools');
    expect(spot).not.toBeNull();
    expect(spot!.tidepool_floor_ft).toBeTypeOf('number');
    expect(spot!.tidepool_floor_confidence).not.toBeNull();
  });

  it('returns null for an unknown slug', () => {
    expect(tidepoolSpotBySlug('not-a-spot')).toBeNull();
    expect(tidepoolSpotBySlug('')).toBeNull();
  });

  it('does not serve Object.prototype keys as spots', () => {
    /*
     * The slug arrives from a URL segment. While SPOT_BY_SLUG inherited
     * Object.prototype these four all returned something truthy, and the guard
     * in tidepoolSpotBySlug is `tidepool_floor_ft !== null` -- which `undefined`
     * satisfies. So each one got past notFound() and was handed on as a Spot,
     * then threw on `spot.wave.intended_primary`: a 500 where a 404 belongs.
     */
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(tidepoolSpotBySlug(key)).toBeNull();
    }
  });

  it('returns null for a real spot with no floor rather than guessing one', () => {
    // Eighteen of twenty-six are in this state. A null floor is unresolved, and
    // inventing one produces a confident state for a reef nobody has measured.
    const floorless = SPOTS_WITHOUT_FLOOR[0]!;
    expect(tidepoolSpotBySlug(floorless.slug)).toBeNull();
  });
});

/* ===========================================================================
 * The servable date window
 * ========================================================================= */

describe('servableDateParam', () => {
  it('accepts today and both bounds', () => {
    expect(servableDateParam('2026-07-28', NOW_MS)).toEqual(TODAY);
    // 30 back, 365 forward.
    expect(servableDateParam('2026-06-28', NOW_MS)).toEqual({ year: 2026, month: 6, day: 28 });
    expect(servableDateParam('2027-07-28', NOW_MS)).toEqual({ year: 2027, month: 7, day: 28 });
  });

  it('refuses one day past either bound', () => {
    expect(servableDateParam('2026-06-27', NOW_MS)).toBeNull();
    expect(servableDateParam('2027-07-29', NOW_MS)).toBeNull();
  });

  it('refuses the dates that used to render a full chart', () => {
    // Both of these returned 200 with real harmonic predictions -- 1900-01-01
    // drew four turning points and a low of -1.5 ft at 3:22 pm. Correct numbers
    // for a page that should never have been served.
    expect(servableDateParam('1900-01-01', NOW_MS)).toBeNull();
    expect(servableDateParam('2030-01-01', NOW_MS)).toBeNull();
    expect(servableDateParam('9999-12-31', NOW_MS)).toBeNull();
  });

  it('still refuses anything that is not a real calendar date', () => {
    // The range check is added to the parse, not swapped for it. 2026-02-30
    // parses as a Date and rolls to 2 March, charting a day the URL does not name.
    for (const bad of ['2026-02-30', '2026-13-01', '26-07-28', '2026-7-28', '2026-07-28T00:00', '']) {
      expect(servableDateParam(bad, NOW_MS)).toBeNull();
    }
  });

  it('moves with the local day, not with the UTC day', () => {
    // 2026-07-28T06:00Z is 23:00 PDT on 27 July. "Today" is still the 27th, so
    // the forward bound is a day earlier than it is an hour later.
    const beforeLocalMidnight = Date.UTC(2026, 6, 28, 6, 0, 0);
    expect(servableDateParam('2027-07-28', beforeLocalMidnight)).toBeNull();
    expect(servableDateParam('2027-07-27', beforeLocalMidnight)).not.toBeNull();
  });

  it('costs no upstream request when it refuses', async () => {
    route();
    // The route calls this before loadSpotDay precisely so that a crawler
    // walking the prev/next chain stops at the bound and CO-OPS never hears it.
    expect(servableDateParam('1900-01-01', NOW_MS)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('isServableDate', () => {
  it('brackets today by SERVABLE_DAYS_BEFORE and SERVABLE_DAYS_AFTER', () => {
    expect(isServableDate(addLocalDays(TODAY, -SERVABLE_DAYS_BEFORE), TODAY)).toBe(true);
    expect(isServableDate(addLocalDays(TODAY, -SERVABLE_DAYS_BEFORE - 1), TODAY)).toBe(false);
    expect(isServableDate(addLocalDays(TODAY, SERVABLE_DAYS_AFTER), TODAY)).toBe(true);
    expect(isServableDate(addLocalDays(TODAY, SERVABLE_DAYS_AFTER + 1), TODAY)).toBe(false);
  });

  it('covers the whole grid horizon, so no cell can link to a 404', () => {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      expect(isServableDate(addLocalDays(TODAY, i), TODAY)).toBe(true);
    }
  });
});

/* ===========================================================================
 * loadSpotWeek
 * ========================================================================= */

describe('loadSpotWeek', () => {
  const spot = TIDEPOOL_SPOTS.find((s) => s.slug === 'cabrillo-tidepools')!;

  it('evaluates one spot across the horizon', async () => {
    route();

    const week = await loadSpotWeek(spot, NOW_MS);

    expect(week.failure).toBeNull();
    expect(week.dates).toHaveLength(HORIZON_DAYS);
    expect(week.days).toHaveLength(HORIZON_DAYS);
    expect(week.days.every((d) => d !== null)).toBe(true);
    expect(week.today).toEqual(TODAY);
    expect(week.spot.slug).toBe('cabrillo-tidepools');
  });

  it('returns a shell of nulls when predictions fail, never a week of zeros', async () => {
    route({ predictions: new Error('upstream down') });

    const week = await loadSpotWeek(spot, NOW_MS);

    expect(week.failure).not.toBeNull();
    expect(week.days).toHaveLength(HORIZON_DAYS);
    // null is "not evaluated". A zero-length window would be a claim about the
    // tide that nothing in this response supports.
    expect(week.days.every((d) => d === null)).toBe(true);
    expect(week.usableCount).toBe(0);
    // Swell was resolved before the failure and is kept: it is still true.
    expect(week.swell.sourceBuoyId).toBe('46232');
  });
});

/* ===========================================================================
 * loadSpotDay
 * ========================================================================= */

describe('loadSpotDay', () => {
  const spot = TIDEPOOL_SPOTS.find((s) => s.slug === 'cabrillo-tidepools')!;

  it('slices the local day and finds its turning points', async () => {
    route();

    const day = await loadSpotDay(spot, TODAY, NOW_MS);

    expect(day.failure).toBeNull();
    expect(day.window).not.toBeNull();
    expect(day.date).toEqual(TODAY);
    // Local midnight to local midnight, in PDT, at 6-minute spacing.
    expect(day.dayStartMs).toBe(Date.UTC(2026, 6, 28, 7, 0, 0));
    expect(day.dayEndMs).toBe(Date.UTC(2026, 6, 29, 7, 0, 0));
    expect(day.daySeries.samples.length).toBeGreaterThan(0);
    expect(day.daySeries.samples[0]!.tMs).toBeGreaterThanOrEqual(day.dayStartMs);
    expect(day.daySeries.samples.at(-1)!.tMs).toBeLessThanOrEqual(day.dayEndMs);
    // Mixed semidiurnal: two highs and two lows of unequal size.
    expect(day.extrema.length).toBeGreaterThanOrEqual(3);
    expect(day.extrema.every((e) => e.tMs >= day.dayStartMs && e.tMs < day.dayEndMs)).toBe(true);
  });

  it('centres its own fetch on the requested date so a deep link outside the grid works', async () => {
    route();

    await loadSpotDay(spot, { year: 2026, month: 9, day: 14 }, NOW_MS);

    const url = new URL(
      fetchMock.mock.calls.find((c) => String(c[0]).includes('tidesandcurrents'))![0] as string,
    );
    expect(url.searchParams.get('begin_date')).toBe('20260913');
    expect(url.searchParams.get('range')).toBe('96');
  });

  it('returns an empty series rather than a flat one when predictions fail', async () => {
    route({ predictions: new Error('no route to host') });

    const day = await loadSpotDay(spot, TODAY, NOW_MS);

    expect(day.failure).not.toBeNull();
    expect(day.window).toBeNull();
    expect(day.daySeries.samples).toEqual([]);
    expect(day.extrema).toEqual([]);
    // The bounds are still true even when nothing could be drawn between them.
    expect(day.dayStartMs).toBe(Date.UTC(2026, 6, 28, 7, 0, 0));
  });
});

/* ===========================================================================
 * Row order
 * ========================================================================= */

/**
 * A row shaped like a real one. Only the fields the sort reads are meaningful;
 * the rest exist so the object typechecks as a SpotRow.
 */
function row(name: string, floorFt: number, lows: number[], usableCount = 0): SpotRow {
  return {
    spot: { name, slug: name.toLowerCase().replace(/\W+/g, '-'), tidepool_floor_ft: floorFt } as SpotRow['spot'],
    swell: {} as SpotRow['swell'],
    ceiling: {} as SpotRow['ceiling'],
    days: lows.map(
      (lowFt) => ({ lowFt, floorFt, minutesRemaining: null, usableMinutes: 0 }) as SpotRow['days'][number],
    ),
    usableCount,
  };
}

describe('bestGapFt', () => {
  it('is the closest any day came to the floor, signed', () => {
    // 2.4 - 1.3 = 1.1, and -0.5 - 1.3 = -1.8, so the best is the week's lowest low.
    expect(bestGapFt(row('Cabrillo', 1.3, [2.4, -0.5, 0.9]))).toBeCloseTo(-1.8, 5);
  });

  it('is negative exactly when some day got under the floor', () => {
    expect(bestGapFt(row('Under', 1.3, [1.2]))).toBeLessThan(0);
    expect(bestGapFt(row('Over', 1.3, [1.4]))).toBeGreaterThan(0);
  });

  it('skips days that would not evaluate', () => {
    const r = row('Gappy', 1.0, [2.0]);
    r.days = [null, r.days[0]!, null];
    expect(bestGapFt(r)).toBeCloseTo(1.0, 5);
  });

  it('sorts a row with no evaluable day last rather than first', () => {
    // Infinity, not 0. A row we know nothing about must not outrank one we do.
    const r = row('Empty', 1.0, []);
    r.days = [null, null];
    expect(bestGapFt(r)).toBe(Infinity);
  });
});

describe('sortRows', () => {
  /*
   * The regression this exists for.
   *
   * Every evaluable spot binds to tide station 9410230, so the lows are
   * identical on every row, and in a week where nothing clears the floor every
   * usableCount is 0 too. Before the gap tie-break, both keys tied on every
   * comparison and the sort fell through to localeCompare -- the control
   * rendered alphabetical order while calling itself "Usable windows".
   */
  const identicalLows = [2.4, -0.5, -0.4];
  const week = () => [
    row('Cabrillo Tidepools', 1.3, identicalLows),
    row('Cardiff Reef', 1.0, identicalLows),
    row('Sunset Cliffs', 0.7, identicalLows),
    row('Windansea', 1.0, identicalLows),
  ];

  it('ranks by closeness to floor when every usable count ties', () => {
    const names = sortRows(week(), 'usable').map((r) => r.spot.name);
    /*
     * Cabrillo first, and the direction is worth pinning because it is easy to
     * get backwards. A HIGHER tidepool_floor_ft is more permissive -- the reef
     * is called workable at higher water. spots.json says so itself: the 1.2.0
     * shift 'moved every floor in the PERMISSIVE direction', and Sunset Cliffs
     * at 0.7 is 'deliberately kept the strictest of the eight'.
     *
     * So against the same tide, Cabrillo at 1.3 ft is 1.1 ft off a window and
     * Sunset Cliffs at 0.7 ft is 1.7 ft off. The permissive floor ranks first.
     */
    expect(names[0]).toBe('Cabrillo Tidepools');
    expect(names[names.length - 1]).toBe('Sunset Cliffs');
  });

  it('is not alphabetical', () => {
    const names = sortRows(week(), 'usable').map((r) => r.spot.name);
    expect(names).not.toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('still puts usable windows above closeness to floor', () => {
    // A spot with a real window outranks a nearer floor with none. The count is
    // an outcome; the gap is only a proxy for one.
    const rows = week();
    rows[2]!.usableCount = 2; // Sunset Cliffs, the strictest floor
    expect(sortRows(rows, 'usable')[0]!.spot.name).toBe('Sunset Cliffs');
  });

  it('breaks a full tie by name, so the order is stable', () => {
    const rows = [row('Windansea', 1.0, [2.4]), row('Cardiff Reef', 1.0, [2.4])];
    expect(sortRows(rows, 'usable').map((r) => r.spot.name)).toEqual([
      'Cardiff Reef',
      'Windansea',
    ]);
  });

  it('leaves geographic order exactly as spots.json wrote it', () => {
    // The file is already ordered north to south. Re-deriving it from latitude
    // would be a second source of truth that could disagree with the file.
    const rows = week();
    expect(sortRows(rows, 'geographic').map((r) => r.spot.name)).toEqual(
      rows.map((r) => r.spot.name),
    );
  });

  it('does not mutate the array it is given', () => {
    const rows = week();
    const before = rows.map((r) => r.spot.name);
    sortRows(rows, 'usable');
    expect(rows.map((r) => r.spot.name)).toEqual(before);
  });
});
