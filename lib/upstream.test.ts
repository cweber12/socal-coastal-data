/**
 * The failure policy, at the fetch boundary.
 *
 * Everything here stubs global fetch. Nothing reaches a network, and several
 * cases assert the stub was NOT called -- a short-circuit that still issues the
 * request is not a short-circuit, and there is no other way to tell from the
 * outside.
 *
 * The policy under test, stated as the module states it:
 *
 *   Predictions failing is FATAL. Every route out of fetchTideSeries that does
 *   not produce a series throws UpstreamError carrying the URL, so the page can
 *   name what it could not reach instead of rendering an empty grid that reads
 *   as "no windows this week".
 *
 *   Swell failing is NOT fatal. fetchSwell never throws. Every failure becomes
 *   an `unavailable` reading carrying its reason, because one quiet buoy must
 *   not take down a grid of eight spots.
 *
 *   Drift is loud but survivable, and distinguishable. `drift: true` separates
 *   "the format changed and this is a bug to chase" from "the buoy is quiet".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_SWELL_AGE_MINUTES,
  UpstreamError,
  fetchSwell,
  fetchTideSeries,
  resolveSpotSwell,
} from './upstream';
import coops6min from './__fixtures__/coops-9410230-20260727-6min.json';
import { SPOT_BY_SLUG, type BuoyId, type Spot } from '@/shared/spots.generated';
import { readFileSync } from 'node:fs';

const NDBC_FIXTURE = readFileSync(
  new URL('./__fixtures__/ndbc-46254-20260728.txt', import.meta.url),
  'utf8',
);

/** The newest row in the NDBC fixture: 2026-07-28 06:26 UTC, WVHT 1.0 m. */
const FIXTURE_NEWEST_MS = Date.UTC(2026, 6, 28, 6, 26, 0);
/** 39 minutes later, which is how old that reading was when it was captured. */
const NOW_MS = Date.UTC(2026, 6, 28, 7, 5, 0);

let fetchMock: ReturnType<typeof vi.fn>;

/** A Response-alike carrying whatever this test wants the endpoint to have said. */
function reply(
  body: string,
  { status = 200, json }: { status?: number; json?: unknown } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => (json !== undefined ? json : JSON.parse(body)),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/* ===========================================================================
 * CO-OPS predictions: failing is fatal, and the URL travels with the failure
 * ========================================================================= */

describe('fetchTideSeries', () => {
  it('parses a captured payload and carries the request contract into the series', async () => {
    fetchMock.mockResolvedValue(reply('', { json: coops6min }));

    const series = await fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72);

    expect(series.samples).toHaveLength(721);
    expect(series.stationId).toBe('9410230');
    // Neither of these is in the payload. Both are request-side facts the parser
    // is told, and they have to travel with the series rather than be re-assumed.
    expect(series.datum).toBe('MLLW');
    expect(series.units).toBe('ft');
    expect(series.timeZone).toBe('UTC');
    expect(series.uniformStepMs).toBe(6 * 60_000);
    expect(series.samples[0]!.tMs).toBe(Date.UTC(2026, 6, 27, 0, 0, 0));
  });

  it('pins every query parameter the payload cannot tell you about', async () => {
    fetchMock.mockResolvedValue(reply('', { json: coops6min }));

    await fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    // time_zone=gmt is the one setting under which reading the offsetless
    // timestamps as UTC is correct. lst_ldt returns the same shape with Pacific
    // digits and ages every reading by 7 hours.
    expect(url.searchParams.get('time_zone')).toBe('gmt');
    expect(url.searchParams.get('units')).toBe('english');
    expect(url.searchParams.get('datum')).toBe('MLLW');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('product')).toBe('predictions');
    expect(url.searchParams.get('begin_date')).toBe('20260727');
    expect(url.searchParams.get('range')).toBe('72');
  });

  it('throws with the URL when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const error = await fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.url).toContain('station=9410230');
    expect(error.message).toContain('ENOTFOUND');
  });

  it('throws on a non-2xx status', async () => {
    fetchMock.mockResolvedValue(reply('', { status: 503, json: {} }));

    await expect(
      fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('throws when the body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>maintenance</html>',
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    await expect(
      fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72),
    ).rejects.toThrow(/not JSON/);
  });

  it('treats a 200 carrying an error body as the dead response it is', async () => {
    // CO-OPS really does serve these with HTTP 200. Freshness beats status.
    fetchMock.mockResolvedValue(
      reply('', { json: { error: { message: 'No Predictions data was found.' } } }),
    );

    const error = await fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).toContain('No Predictions data was found');
    expect(error.message).toContain('HTTP 200');
  });

  it('treats a 200 carrying an empty predictions array as dead, not as a flat tide', async () => {
    fetchMock.mockResolvedValue(reply('', { json: { predictions: [] } }));

    await expect(
      fetchTideSeries('9410230', { year: 2026, month: 7, day: 27 }, 72),
    ).rejects.toThrow(/empty/i);
  });
});

/* ===========================================================================
 * NDBC swell: never throws, and says why
 * ========================================================================= */

describe('fetchSwell', () => {
  it('converts the newest usable row from metres on a confirmed unit string', async () => {
    fetchMock.mockResolvedValue(reply(NDBC_FIXTURE));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('ok');
    if (reading.kind !== 'ok') return;
    expect(reading.swellMetres).toBe(1.0);
    expect(reading.swellFt).toBeCloseTo(3.2808, 3);
    expect(reading.observedAtMs).toBe(FIXTURE_NEWEST_MS);
    expect(reading.ageMinutes).toBeCloseTo(39, 5);
    expect(reading.buoyId).toBe('46254');
  });

  it('short-circuits a buoy the inventory already marks dead, without a request', async () => {
    // 46235 is decommissioned. Spending a request to rediscover that every
    // render is the thing the inventory exists to prevent.
    const reading = await fetchSwell('46235', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    if (reading.kind !== 'unavailable') return;
    expect(reading.reason).toMatch(/marked dead/);
    expect(reading.drift).toBe(false);
  });

  it('reports a 404 as a buoy that is not publishing', async () => {
    fetchMock.mockResolvedValue(reply('', { status: 404 }));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.reason).toMatch(/404/);
    expect(reading.drift).toBe(false);
  });

  it('does not throw when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.reason).toMatch(/socket hang up/);
  });

  it('flags a moved WVHT column as drift rather than reading whatever is in its place', async () => {
    // Dropping WVHT would otherwise leave DPD -- 8 to 20 for these buoys -- in
    // slot 9, which renders as a twenty-foot swell.
    const drifted = NDBC_FIXTURE.split('\n')
      .map((line) => line.replace(/\bWVHT\b/, 'WVHZ'))
      .join('\n');
    fetchMock.mockResolvedValue(reply(drifted));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.drift).toBe(true);
    expect(reading.reason).toMatch(/no WVHT column/i);
  });

  it('flags a changed unit string as drift and refuses to convert', async () => {
    const lines = NDBC_FIXTURE.split('\n');
    // The units row, with WVHT's 'm' replaced by 'ft'. TIDE in the same row is
    // already in feet, so there is no file-wide unit to fall back on.
    lines[1] = lines[1]!.replace(/(\s)m(\s+sec)/, '$1ft$2');
    fetchMock.mockResolvedValue(reply(lines.join('\n')));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.drift).toBe(true);
    expect(reading.reason).toMatch(/published in/);
  });

  it('separates a quiet buoy from a drifted one when every row is MM', async () => {
    const lines = NDBC_FIXTURE.split('\n');
    const blanked = lines
      .map((line, i) => (i < 2 ? line : line.replace(/(\s)\d\.\d(\s+\d+\s+\d\.\d)/, '$1 MM$2')))
      .join('\n');
    fetchMock.mockResolvedValue(reply(blanked));

    const reading = await fetchSwell('46254', NOW_MS);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    // Answering but not reporting is a quiet buoy, not a format change.
    expect(reading.drift).toBe(false);
    expect(reading.reason).toMatch(/not reporting wave height/);
  });

  it('reports a reading past the age limit as unknown rather than as current', async () => {
    fetchMock.mockResolvedValue(reply(NDBC_FIXTURE));
    const wayLater = FIXTURE_NEWEST_MS + (MAX_SWELL_AGE_MINUTES + 1) * 60_000;

    const reading = await fetchSwell('46254', wayLater);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.reason).toMatch(/past the 180 min limit/);
    expect(reading.drift).toBe(false);
  });

  it('accepts a reading exactly at the age limit', async () => {
    fetchMock.mockResolvedValue(reply(NDBC_FIXTURE));
    const atLimit = FIXTURE_NEWEST_MS + MAX_SWELL_AGE_MINUTES * 60_000;

    const reading = await fetchSwell('46254', atLimit);

    expect(reading.kind).toBe('ok');
  });

  it('fails a future timestamp rather than reporting on an unestablished clock', async () => {
    fetchMock.mockResolvedValue(reply(NDBC_FIXTURE));
    // Reading the offsetless time columns as Pacific instead of UTC puts the
    // newest row seven hours ahead. That has to fail, not report.
    const sevenHoursBefore = FIXTURE_NEWEST_MS - 7 * 60 * 60_000;

    const reading = await fetchSwell('46254', sevenHoursBefore);

    expect(reading.kind).toBe('unavailable');
    if (reading.kind !== 'unavailable') return;
    expect(reading.drift).toBe(true);
    expect(reading.reason).toMatch(/in the future/);
  });
});

/* ===========================================================================
 * Per-spot resolution: the substitution is disclosed, never silent
 * ========================================================================= */

describe('resolveSpotSwell', () => {
  const cabrillo = SPOT_BY_SLUG['cabrillo-tidepools'];

  /** Answer per buoy id, so a test can kill the primary and keep the fallback. */
  const routeByBuoy = (answers: Partial<Record<BuoyId, Response>>) => {
    fetchMock.mockImplementation(async (url: string) => {
      const id = /realtime2\/(\d+)\.txt/.exec(url)?.[1] as BuoyId | undefined;
      const answer = id ? answers[id] : undefined;
      return answer ?? reply('', { status: 404 });
    });
  };

  it('uses the primary and does not touch the fallback when the primary delivers', async () => {
    routeByBuoy({ '46232': reply(NDBC_FIXTURE), '46258': reply(NDBC_FIXTURE) });

    const swell = await resolveSpotSwell(cabrillo, NOW_MS);

    expect(swell.sourceBuoyId).toBe('46232');
    expect(swell.substituted).toBe(false);
    expect(swell.problems).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back and marks the substitution, keeping the primary failure visible', async () => {
    routeByBuoy({ '46232': reply('', { status: 404 }), '46258': reply(NDBC_FIXTURE) });

    const swell = await resolveSpotSwell(cabrillo, NOW_MS);

    expect(swell.sourceBuoyId).toBe('46258');
    // spots.json's schema requires the UI to disclose this: a fallback may be
    // geographically distant and read differently for the same conditions.
    expect(swell.substituted).toBe(true);
    expect(swell.swellFt).toBeCloseTo(3.2808, 3);
    // The primary's failure is not swallowed just because the fallback worked.
    expect(swell.problems).toHaveLength(1);
    expect(swell.problems[0]).toMatch(/404/);
  });

  it('returns unknown, not calm, when nothing in the binding delivers', async () => {
    routeByBuoy({});

    const swell = await resolveSpotSwell(cabrillo, NOW_MS);

    expect(swell.swellFt).toBeNull();
    expect(swell.sourceBuoyId).toBeNull();
    expect(swell.substituted).toBe(false);
    expect(swell.problems).toHaveLength(2);
  });

  it('propagates the drift flag from whichever attempt hit it', async () => {
    const drifted = NDBC_FIXTURE.replace(/\bWVHT\b/, 'WVHZ');
    routeByBuoy({ '46232': reply(drifted), '46258': reply(NDBC_FIXTURE) });

    const swell = await resolveSpotSwell(cabrillo, NOW_MS);

    expect(swell.drift).toBe(true);
    expect(swell.sourceBuoyId).toBe('46258');
    expect(swell.substituted).toBe(true);
  });

  it('reports a spot with no wave binding without issuing a request', async () => {
    const unbound = {
      ...cabrillo,
      wave: { primary: null, fallback: null },
    } as unknown as Spot;

    const swell = await resolveSpotSwell(unbound, NOW_MS);

    expect(swell.swellFt).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(swell.problems[0]).toMatch(/no wave binding/);
  });

  it('does not query the same buoy twice when primary and fallback are identical', async () => {
    const sameBoth = {
      ...cabrillo,
      wave: { primary: '46232', fallback: '46232' },
    } as unknown as Spot;
    routeByBuoy({});

    await resolveSpotSwell(sameBoth, NOW_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('carries intended_primary through so the UI can say the reading is a stand-in', async () => {
    // Four spots bind a dead 46235 as intended_primary. None carries a floor, so
    // none reaches the grid -- but the field is the contract, and the resolver
    // has to pass it on regardless of who currently reads it.
    const withIntended = {
      ...cabrillo,
      wave: { primary: '46232', fallback: '46258', intended_primary: '46235' },
    } as unknown as Spot;
    routeByBuoy({ '46232': reply(NDBC_FIXTURE) });

    const swell = await resolveSpotSwell(withIntended, NOW_MS);

    expect(swell.intendedBuoyId).toBe('46235');
    expect(swell.sourceBuoyId).toBe('46232');
  });
});
