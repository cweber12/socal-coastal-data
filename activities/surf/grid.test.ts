/**
 * The failure policy, at surf's composition boundary.
 *
 * The same asymmetry activities/tidepool/grid.test.ts pins, asserted again here
 * because it is a COPY rather than a shared module -- and a copy that silently
 * lost the policy would look identical until an upstream failed:
 *
 *   Predictions failing is FATAL to the grid. There is nothing to show, so it
 *   comes back as `failure` and `rows` is empty -- the page renders a named
 *   failure rather than an empty grid, because an empty grid is a claim about
 *   the tide while this is a claim about the connection.
 *
 *   Swell failing is NOT fatal. It becomes a null reading, which the predicate
 *   turns into `swell-tbd`, which can never render as a pass. That matters more
 *   on this grid than on tidepool's: swell is half of a surf verdict.
 *
 *   A day that will not evaluate is COLLECTED, not thrown.
 *
 * Every test stubs global fetch. `nowMs` is pinned to 2026-07-28T07:05Z, which
 * is 00:05 PDT on 28 July and 39 minutes after the newest row in the NDBC
 * fixture, so the swell reads as current rather than stale.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  HORIZON_DAYS,
  SERVABLE_DAYS_AFTER,
  SERVABLE_DAYS_BEFORE,
  isServableDate,
  loadSurfGrid,
  loadSurfSpotDay,
  servableDateParam,
  sortRows,
  surfSpotBySlug,
  usableMinutes,
  type SurfRow,
} from './grid';
import { addLocalDays } from '../../core/time';
import coops240h from '../../core/feeds/__fixtures__/coops-9410230-20260727-240h.json';
import { SPOTS_OUTSIDE_SURF, SURF_SPOTS } from '../../core/zones/surf';

const NDBC_FIXTURE = readFileSync(
  new URL('../../core/feeds/__fixtures__/ndbc-46254-20260728.txt', import.meta.url),
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

function route({
  predictions = jsonReply(coops240h),
  swell = textReply(NDBC_FIXTURE),
}: {
  predictions?: Response | Error;
  swell?: Response | Error;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('tidesandcurrents')) {
      if (predictions instanceof Error) throw predictions;
      return predictions;
    }
    if (swell instanceof Error) throw swell;
    return swell;
  });
}

const coopsCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('tidesandcurrents')).length;

const inatCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('inaturalist')).length;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/* ===========================================================================
 * loadSurfGrid
 * ========================================================================= */

describe('loadSurfGrid', () => {
  it('composes every surf-zone spot across the horizon', async () => {
    route();

    const grid = await loadSurfGrid(NOW_MS);

    expect(grid.failure).toBeNull();
    expect(grid.rows).toHaveLength(SURF_SPOTS.length);
    expect(grid.rows).toHaveLength(24);
    expect(grid.days).toHaveLength(HORIZON_DAYS);
    expect(grid.today).toEqual(TODAY);
    expect(grid.evaluatedAtMs).toBe(NOW_MS);
    expect(grid.timeZone).toBe('America/Los_Angeles');
    // Corridor order, north to south, straight from spots.json.
    expect(grid.rows[0]!.spot.slug).toBe('oceanside-harbor');
    expect(grid.rows.at(-1)!.spot.slug).toBe('border-field');
    expect(grid.rows.every((r) => r.days.every((d) => d !== null))).toBe(true);
  });

  it('fetches predictions once per station, not once per spot', async () => {
    // All 24 bind 9410230 today. 24 requests for one series would be 24 times the
    // traffic for the same answer, and the cost of getting this wrong grows with
    // the grid rather than staying flat.
    route();
    await loadSurfGrid(NOW_MS);
    expect(coopsCalls()).toBe(1);
  });

  it('never asks iNaturalist for anything', async () => {
    /*
     * The clearest thing this copy did NOT carry across. Sightings are about
     * what is living on an exposed reef; there is no surf equivalent, and a
     * copied-and-left-empty section would have cost 24 requests per render to
     * say nothing.
     */
    route();
    await loadSurfGrid(NOW_MS);
    expect(inatCalls()).toBe(0);
  });

  it('carries the two lagoons as excluded, with the zone module’s reason', async () => {
    route();
    const grid = await loadSurfGrid(NOW_MS);

    expect(grid.excluded).toEqual(SPOTS_OUTSIDE_SURF);
    expect(grid.excluded.map((n) => n.spot.slug)).toEqual([
      'batiquitos-lagoon',
      'san-elijo-lagoon',
    ]);
    // The counts must add up to the inventory, so a page can show that no spot
    // fell down the gap between the grid and the disclosure.
    const { members, notInZone, unresolved, inventory } = grid.membership;
    expect(members + notInZone + unresolved).toBe(inventory);
    expect(members).toBe(grid.rows.length);
  });

  it('applies the per-spot ceilings, and the corridor default everywhere else', async () => {
    route();
    const grid = await loadSurfGrid(NOW_MS);

    const ceilingOf = (slug: string) =>
      grid.rows.find((r) => r.spot.slug === slug)!.ceiling;

    // The two overrides #128 filed and nothing read until now.
    expect(ceilingOf('blacks-beach').ceilingFt).toBe(2.0);
    expect(ceilingOf('blacks-beach').isDefault).toBe(false);
    expect(ceilingOf('tourmaline').ceilingFt).toBe(4.0);
    expect(ceilingOf('tourmaline').isDefault).toBe(false);

    // Everything else takes the corridor default, and says so.
    expect(ceilingOf('windansea').isDefault).toBe(true);

    // Every one of them uncalibrated. If this ever fails, the disclosure copy on
    // both surf pages has stopped being true.
    for (const row of grid.rows) expect(row.ceiling.confidence).toBe('uncalibrated');
  });

  it('is fatal when predictions fail, and says so rather than showing an empty grid', async () => {
    route({ predictions: new Error('ECONNRESET') });

    const grid = await loadSurfGrid(NOW_MS);

    expect(grid.rows).toEqual([]);
    expect(grid.failure).not.toBeNull();
    expect(grid.failure!.message).toMatch(/ECONNRESET/);
    // The excluded spots and the membership accounting survive a failure, so the
    // page can still say what it does not cover.
    expect(grid.excluded).toEqual(SPOTS_OUTSIDE_SURF);
  });

  it('is not fatal when swell fails: the day goes swell-tbd, never go', async () => {
    route({ swell: new Error('ETIMEDOUT') });

    const grid = await loadSurfGrid(NOW_MS);

    expect(grid.failure).toBeNull();
    expect(grid.rows.length).toBeGreaterThan(0);
    for (const row of grid.rows) {
      expect(row.swell.swellFt).toBeNull();
      for (const day of row.days) {
        expect(day, 'a swell failure must not take out a day').not.toBeNull();
        expect(day!.state).not.toBe('go');
        expect(day!.state).not.toBe('flat');
      }
      expect(row.usableCount).toBe(0);
    }
    expect(grid.notices.length).toBeGreaterThan(0);
  });

  it('discloses the dead intended buoy for the four spots that carry one', async () => {
    /*
     * FOUR, not six. shared/spots.json's note on 46235 says "six south-corridor
     * spots fall back to 46232", and those six are the spots whose PRIMARY is
     * 46232 -- Sunset Cliffs and Cabrillo among them. Only four carry
     * `wave.intended_primary: "46235"`, which is the field that says a spot is
     * being served by a stand-in for a dead buoy: Coronado Central, Silver
     * Strand, Imperial Beach Pier and Border Field.
     *
     * All four are surf-zone members, so this grid is where that substitution is
     * most visible. If 46235 ever flips to REVIVED, these four are the rows that
     * change and this count is what says so.
     */
    route();
    const grid = await loadSurfGrid(NOW_MS);

    const stranded = grid.rows.filter((r) => r.swell.intendedBuoyId === '46235');
    expect(stranded.map((r) => r.spot.slug)).toEqual([
      'coronado-central',
      'silver-strand',
      'imperial-beach-pier',
      'border-field',
    ]);
    for (const row of stranded) {
      expect(
        grid.notices.some((n) => n.message.includes(row.spot.name) && n.message.includes('46235')),
      ).toBe(true);
    }
  });
});

/* ===========================================================================
 * Row order
 * ========================================================================= */

describe('sortRows', () => {
  const row = (name: string, usableCount: number, minutes: number[]): SurfRow =>
    ({
      spot: { name, slug: name.toLowerCase() } as SurfRow['spot'],
      swell: {} as SurfRow['swell'],
      ceiling: {} as SurfRow['ceiling'],
      days: minutes.map(
        (m) => ({ sessions: [{ usableMinutes: m }] }) as unknown as SurfRow['days'][number],
      ),
      usableCount,
    }) as SurfRow;

  it('leaves geographic order exactly as the file gave it', () => {
    const rows = [row('C', 0, [0]), row('A', 3, [500]), row('B', 1, [100])];
    expect(sortRows(rows, 'geographic').map((r) => r.spot.name)).toEqual(['C', 'A', 'B']);
  });

  it('ranks by usable days first', () => {
    const rows = [row('C', 0, [0]), row('A', 3, [10]), row('B', 1, [900])];
    expect(sortRows(rows, 'usable').map((r) => r.spot.name)).toEqual(['A', 'B', 'C']);
  });

  it('breaks a tie on total usable minutes rather than falling through to the name', () => {
    /*
     * The bug tidepool's sort shipped once: every key tied and the control
     * labelled "Usable windows" rendered alphabetical order. Here the counts tie
     * constantly, because all 24 spots read the same tide station -- so the
     * tie-break has to be a key that genuinely varies.
     */
    const rows = [row('Zulu', 0, [200, 100]), row('Alpha', 0, [50])];
    expect(sortRows(rows, 'usable').map((r) => r.spot.name)).toEqual(['Zulu', 'Alpha']);
  });

  it('sums usable minutes across every session of every day', () => {
    expect(usableMinutes(row('X', 0, [60, 30, 10]))).toBe(100);
  });

  it('skips null days rather than counting them as zero-length sessions', () => {
    const withNull = row('X', 0, [60]);
    withNull.days.push(null);
    expect(usableMinutes(withNull)).toBe(60);
  });
});

/* ===========================================================================
 * The day route's bounds
 * ========================================================================= */

describe('what the day route will answer for', () => {
  it('serves the servable window and refuses either side of it', () => {
    const today = TODAY;
    expect(isServableDate(addLocalDays(today, SERVABLE_DAYS_AFTER), today)).toBe(true);
    expect(isServableDate(addLocalDays(today, SERVABLE_DAYS_AFTER + 1), today)).toBe(false);
    expect(isServableDate(addLocalDays(today, -SERVABLE_DAYS_BEFORE), today)).toBe(true);
    expect(isServableDate(addLocalDays(today, -SERVABLE_DAYS_BEFORE - 1), today)).toBe(false);
  });

  it('refuses a date that does not round-trip, rather than rolling it', async () => {
    // `2026-02-30` parses as a Date in JS and rolls to 2 March, which would chart
    // a different day than the URL names.
    expect(servableDateParam('2026-02-30', NOW_MS)).toBeNull();
    expect(servableDateParam('2026-7-4', NOW_MS)).toBeNull();
    expect(servableDateParam('not-a-date', NOW_MS)).toBeNull();
    expect(servableDateParam('2026-07-30', NOW_MS)).toEqual({ year: 2026, month: 7, day: 30 });
  });

  it('costs no upstream request when it refuses', async () => {
    route();
    expect(servableDateParam('2029-01-01', NOW_MS)).toBeNull();
    expect(coopsCalls()).toBe(0);
  });
});

/* ===========================================================================
 * One spot, one day
 * ========================================================================= */

describe('loadSurfSpotDay', () => {
  it('returns the day, its curve and its turning points', async () => {
    route();
    const spot = surfSpotBySlug('windansea')!;
    const result = await loadSurfSpotDay(spot, { year: 2026, month: 7, day: 30 }, NOW_MS);

    expect(result.failure).toBeNull();
    expect(result.day).not.toBeNull();
    expect(result.daySeries.samples.length).toBeGreaterThan(200);
    // Mixed semidiurnal: normally four turns in a local day.
    expect(result.extrema.length).toBeGreaterThanOrEqual(3);
    expect(result.spot.slug).toBe('windansea');
  });

  it('comes back as a named failure when predictions fail, with the curve empty', async () => {
    route({ predictions: new Error('502 Bad Gateway') });
    const spot = surfSpotBySlug('windansea')!;
    const result = await loadSurfSpotDay(spot, { year: 2026, month: 7, day: 30 }, NOW_MS);

    expect(result.failure).not.toBeNull();
    expect(result.day).toBeNull();
    expect(result.daySeries.samples).toEqual([]);
    expect(result.extrema).toEqual([]);
  });

  it('resolves a surf-only spot that the intertidal grid has no answer for', async () => {
    // Sixteen of the twenty-four are in the surf zone and not the intertidal.
    // This is the lookup the day route uses, and it must not be tidepool's.
    expect(surfSpotBySlug('oceanside-pier')).not.toBeNull();
    expect(surfSpotBySlug('mission-beach')).not.toBeNull();
  });

  it('returns null for a lagoon and for an unknown slug alike', async () => {
    expect(surfSpotBySlug('batiquitos-lagoon')).toBeNull();
    expect(surfSpotBySlug('not-a-spot')).toBeNull();
  });
});
