/**
 * Acquisition: the cursor walk, the record parser, and the CO-OPS seam checks.
 *
 * The cursor walk is the part that fails silently by nature. `page`-based paging
 * returns HTTP 403 past 10,000 results, and a try/except around that 403
 * produces a truncated, order-biased sample that looks exactly like a complete
 * one. So this file asserts completeness three ways -- against a real captured
 * two-page pull, against a stub whose page boundaries are known exactly, and
 * against a stub that lies about ordering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dedupeSeam,
  fetchYearSeries,
  inatPullUrl,
  parsePull,
  pullSpot,
  CALIBRATION_FIELDS,
} from './acquire.ts';
import { PER_PAGE } from './config.ts';
import multipage from '../__fixtures__/inat-cabrillo-cc-multipage.json' with { type: 'json' };
import coops2026 from '../__fixtures__/coops-9410230-2026.json' with { type: 'json' };

const CABRILLO = { slug: 'cabrillo-tidepools', lat: 32.669, lon: -117.245 };
const NOW_MS = Date.UTC(2026, 6, 29);

/* ===========================================================================
 * The query
 * ========================================================================= */

describe('inatPullUrl', () => {
  const options = {
    slug: 'cabrillo-tidepools',
    lat: 32.669,
    lon: -117.245,
    radiusKm: 1,
    taxonIds: [48645, 48655],
    since: { year: 2016, month: 1, day: 1 },
  };

  it('orders by ascending id, which is what makes id_above meaningful', () => {
    const url = new URL(inatPullUrl(options, 0));
    // Any other sort makes the cursor meaningless and the walk lossy or endless.
    expect(url.searchParams.get('order_by')).toBe('id');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(url.searchParams.get('id_above')).toBe('0');
    expect(url.searchParams.get('per_page')).toBe(String(PER_PAGE));
  });

  it('pins the filters the pipeline depends on', () => {
    const url = new URL(inatPullUrl(options, 0));
    expect(url.searchParams.get('quality_grade')).toBe('research');
    expect(url.searchParams.get('radius')).toBe('1');
    expect(url.searchParams.get('d1')).toBe('2016-01-01');
    expect(url.searchParams.get('taxon_id')).toBe('48645,48655');
  });

  it('does NOT send geoprivacy or captive, so their attrition stays measurable', () => {
    /*
     * #32 requires "obscuring losses by taxon" as a report diagnostic, and a
     * record filtered server-side cannot be counted. They are dropped in memory
     * instead, which yields the identical record set and a measurable one.
     */
    const url = new URL(inatPullUrl(options, 0));
    expect(url.searchParams.get('geoprivacy')).toBeNull();
    expect(url.searchParams.get('captive')).toBeNull();
  });

  it('never sends an accuracy bar', () => {
    // acc_below silently excludes NULL accuracy as well as imprecise accuracy.
    // At Cabrillo those are 18% and 18% -- two different things, one parameter.
    const url = new URL(inatPullUrl(options, 0));
    expect(url.searchParams.get('acc_below')).toBeNull();
    expect(url.searchParams.get('acc')).toBeNull();
  });

  it('asks for ancestry, without which the genus target matches nothing', () => {
    expect(CALIBRATION_FIELDS).toContain('taxon.ancestor_ids');
  });

  it('sends a licence filter only when one is asked for', () => {
    expect(new URL(inatPullUrl(options, 0)).searchParams.get('license')).toBeNull();
    expect(
      new URL(inatPullUrl({ ...options, licenses: ['cc0', 'cc-by'] }, 0)).searchParams.get(
        'license',
      ),
    ).toBe('cc0,cc-by');
  });
});

/* ===========================================================================
 * The cursor walk
 * ========================================================================= */

describe('the captured two-page pull', () => {
  it('is genuinely more than one page, which is what makes it a cursoring fixture', () => {
    expect(multipage.pages).toBe(2);
    expect(multipage.results.length).toBeGreaterThan(PER_PAGE);
  });

  it('carries every record iNaturalist counted, with no overlap and no gap', () => {
    expect(multipage.results).toHaveLength(multipage.totalResults);

    const ids = (multipage.results as { id: number }[]).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });

  it('crosses the page boundary without losing the record either side of it', () => {
    // The 200th and 201st records are the last of page one and the first of page
    // two. A cursor set from the wrong row drops or repeats exactly here.
    const ids = (multipage.results as { id: number }[]).map((r) => r.id);
    expect(ids[PER_PAGE - 1]).toBeLessThan(ids[PER_PAGE]!);
  });
});

describe('pullSpot', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  /** A stub serving `total` records in pages of PER_PAGE, honouring id_above. */
  function servePages(total: number, ids?: number[]) {
    const all = ids ?? Array.from({ length: total }, (_, i) => 1000 + i * 7);
    fetchMock.mockImplementation(async (url: string) => {
      const above = Number(new URL(url).searchParams.get('id_above'));
      const page = all.filter((id) => id > above).slice(0, PER_PAGE);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total_results: all.length,
          results: page.map((id) => ({ id })),
        }),
      } as unknown as Response;
    });
    return all;
  }

  const options = {
    slug: 'cabrillo-tidepools',
    lat: 32.669,
    lon: -117.245,
    radiusKm: 1,
    taxonIds: [48645],
    since: { year: 2016, month: 1, day: 1 },
  };

  it('returns a complete set across several pages and does not truncate', async () => {
    const all = servePages(453);

    const pull = await pullSpot(options, '2026-07-29', 0);

    expect(pull.results).toHaveLength(453);
    expect(pull.pages).toBe(3);
    expect((pull.results as { id: number }[]).map((r) => r.id)).toEqual(all);
  });

  it('advances the cursor from the last id of each page', async () => {
    const all = servePages(250);
    await pullSpot(options, '2026-07-29', 0);

    const cursors = fetchMock.mock.calls.map((c) =>
      Number(new URL(String(c[0])).searchParams.get('id_above')),
    );
    expect(cursors).toEqual([0, all[PER_PAGE - 1]]);
  });

  it('stops on a short page rather than on the count', async () => {
    /*
     * total_results can move between requests as records are identified. A walk
     * that stopped when it had "enough" would end early on a corpus that grew
     * mid-pull, and quietly return a truncated set.
     */
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          // Claims 10 the first time and 9,999 afterwards. The walk must ignore
          // both and stop because the page was short.
          total_results: call === 1 ? 10 : 9999,
          results: Array.from({ length: 10 }, (_, i) => ({ id: call * 1000 + i })),
        }),
      } as unknown as Response;
    });

    const pull = await pullSpot(options, '2026-07-29', 0);
    expect(pull.results).toHaveLength(10);
    expect(pull.pages).toBe(1);
  });

  it('refuses to continue on the 403 that means the cursor is not being applied', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as unknown as Response);
    await expect(pullSpot(options, '2026-07-29', 0)).rejects.toThrow(/10000-result window/);
  });

  it('throws when ids do not strictly increase, rather than claiming completeness', async () => {
    // A server that ignored id_above would serve page one again for ever. The
    // ordering assertion is what turns that from an infinite loop into an error.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total_results: 500,
        results: Array.from({ length: PER_PAGE }, (_, i) => ({ id: 1000 + i })),
      }),
    }) as unknown as Response);

    await expect(pullSpot(options, '2026-07-29', 0)).rejects.toThrow(
      /not greater than the previous/,
    );
  });
});

/* ===========================================================================
 * Parsing
 * ========================================================================= */

describe('parsePull', () => {
  const base = {
    id: 1,
    quality_grade: 'research',
    captive: false,
    observed_on: '2026-03-10',
    time_observed_at: '2026-03-10T10:00:00-08:00',
    location: '32.669,-117.245',
    geoprivacy: null,
    taxon_geoprivacy: null,
    obscured: false,
    positional_accuracy: 20,
    user: { login: 'alice' },
    taxon: { id: 48645, ancestor_ids: [47115, 48645] },
  };

  const parse = (rows: unknown[]) => parsePull(rows, CABRILLO, 1, NOW_MS);

  it('parses a well-formed row', () => {
    const { records, exclusions } = parse([base]);
    expect(records).toHaveLength(1);
    expect(records[0]!.observerLogin).toBe('alice');
    expect(records[0]!.observedOn).toEqual({ year: 2026, month: 3, day: 10 });
    expect(records[0]!.observedAtMs).toBe(Date.UTC(2026, 2, 10, 18, 0, 0));
    expect(records[0]!.ancestorIds).toContain(48645);
    expect(Object.values(exclusions).every((v) => v === 0)).toBe(true);
  });

  it('drops and counts a captive record', () => {
    const { records, exclusions } = parse([{ ...base, captive: true }]);
    expect(records).toHaveLength(0);
    expect(exclusions.captive).toBe(1);
  });

  it('drops and counts a record that is not research grade', () => {
    const { exclusions } = parse([{ ...base, quality_grade: 'needs_id' }]);
    expect(exclusions.notResearchGrade).toBe(1);
  });

  it('drops an obscured record but keeps it for the loss tally', () => {
    // Its coordinate is randomised within ~0.2°, so it can never be placed at a
    // reef -- but it is what the by-taxon obscuring table is counted from.
    const { records, obscuredRecords, exclusions } = parse([
      { ...base, geoprivacy: 'obscured' },
      { ...base, id: 2, taxon_geoprivacy: 'private' },
      { ...base, id: 3, obscured: true },
    ]);
    expect(records).toHaveLength(0);
    expect(obscuredRecords).toHaveLength(3);
    expect(exclusions.obscured).toBe(3);
  });

  it('does not confuse taxon_geoprivacy "open" with a withheld coordinate', () => {
    const { records } = parse([{ ...base, taxon_geoprivacy: 'open' }]);
    expect(records).toHaveLength(1);
  });

  it('rejects a future-dated record and counts it', () => {
    const { records, futureDated } = parse([
      { ...base, time_observed_at: '2027-01-01T10:00:00-08:00' },
    ]);
    expect(records).toHaveLength(0);
    expect(futureDated).toBe(1);
  });

  it('drops a record outside the radius', () => {
    // ~4 km north of Cabrillo.
    const { records, exclusions } = parse([{ ...base, location: '32.705,-117.245' }]);
    expect(records).toHaveLength(0);
    expect(exclusions.outsideRadius).toBe(1);
  });

  it('drops a record with no local date, rather than deriving one from the timestamp', () => {
    // Deriving observed_on from the UTC timestamp would put a Pacific evening
    // record on the following day and into a different day's tide.
    const { exclusions } = parse([{ ...base, observed_on: null }]);
    expect(exclusions.noObservedOn).toBe(1);
  });

  it('keeps a record with a date and no time', () => {
    // About 1% of the historical corpus. The predictor is the day's low, so a
    // missing time costs nothing; only the timestamp diagnostic loses it.
    const { records } = parse([{ ...base, time_observed_at: null }]);
    expect(records).toHaveLength(1);
    expect(records[0]!.observedAtMs).toBeNull();
  });

  it('keeps a null positional accuracy as null rather than as a number', () => {
    const { records } = parse([{ ...base, positional_accuracy: null }]);
    expect(records[0]!.positionalAccuracyM).toBeNull();
  });

  it('throws on a timestamp with no offset', () => {
    expect(() => parse([{ ...base, time_observed_at: '2026-03-10T10:00:00' }])).toThrow(
      /no\s+explicit UTC offset/,
    );
  });

  it('throws when ancestry is missing', () => {
    expect(() => parse([{ ...base, taxon: { id: 48645 } }])).toThrow(/ancestor_ids is missing/);
  });

  it('throws when there is no observer to key a visit on', () => {
    expect(() => parse([{ ...base, user: {} }])).toThrow(/user\.login is missing/);
  });
});

/* ===========================================================================
 * CO-OPS across years
 * ========================================================================= */

describe('fetchYearSeries', () => {
  it('concatenates years, drops the shared seam sample, and finds no gap', async () => {
    /*
     * CO-OPS treats `range` as inclusive of both endpoints, so a request
     * covering a whole year ENDS on the next year's first sample and
     * consecutive years share it. Serving the same captured year twice is the
     * sharpest version of that: without the dedupe the seam is a duplicate
     * timestamp, and with a wrong dedupe it is a gap.
     */
    const { series } = await fetchYearSeries('9410230', 'MLLW', 2026, 2026, async () => coops2026);
    expect(series.samples).toHaveLength(87_601);

    for (let i = 1; i < series.samples.length; i++) {
      expect(series.samples[i]!.tMs - series.samples[i - 1]!.tMs).toBe(6 * 60_000);
    }
  });

  it('asks for 8784 hours in a leap year and 8760 otherwise', async () => {
    const urls: string[] = [];
    await fetchYearSeries('9410230', 'MLLW', 2024, 2024, async (url) => {
      urls.push(url);
      return coops2026;
    });
    // 2024 is a leap year: 366 x 24.
    expect(new URL(urls[0]!).searchParams.get('range')).toBe('8784');

    urls.length = 0;
    await fetchYearSeries('9410230', 'MLLW', 2026, 2026, async (url) => {
      urls.push(url);
      return coops2026;
    });
    expect(new URL(urls[0]!).searchParams.get('range')).toBe('8760');
  });

  it('pins the three parameters the payload cannot tell you about', async () => {
    const urls: string[] = [];
    await fetchYearSeries('9410230', 'MLLW', 2026, 2026, async (url) => {
      urls.push(url);
      return coops2026;
    });
    const url = new URL(urls[0]!);
    expect(url.searchParams.get('time_zone')).toBe('gmt');
    expect(url.searchParams.get('units')).toBe('english');
    expect(url.searchParams.get('datum')).toBe('MLLW');
    // Its own courtesy identifier, so NOAA can tell pipeline traffic from the
    // web app's.
    expect(url.searchParams.get('application')).toBe('socal-coastal-data-calibration');
  });
});

describe('dedupeSeam', () => {
  it('removes only an adjacent repeat of the same instant', () => {
    const samples = [
      { tMs: 0, ft: 1 },
      { tMs: 0, ft: 1 },
      { tMs: 360_000, ft: 2 },
      { tMs: 720_000, ft: 3 },
    ];
    expect(dedupeSeam(samples)).toHaveLength(3);
  });

  it('leaves a clean series untouched', () => {
    const samples = [
      { tMs: 0, ft: 1 },
      { tMs: 360_000, ft: 2 },
    ];
    expect(dedupeSeam(samples)).toEqual(samples);
  });
});

describe('the count check', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('carries the shortfall rather than swallowing it, and does not treat it as fatal', async () => {
    // iNaturalist claims 12; the walk finds 10. Records reach research grade
    // while a fifty-page pull is in flight, so a small discrepancy is ordinary --
    // but a large one is not, and the only way to tell is to report the number.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        total_results: 12,
        results: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
      }),
    } as unknown as Response);

    const pull = await pullSpot(
      {
        slug: 'cabrillo-tidepools',
        lat: 32.669,
        lon: -117.245,
        radiusKm: 1,
        taxonIds: [48645],
        since: { year: 2016, month: 1, day: 1 },
      },
      '2026-07-29',
      0,
    );

    expect(pull.results).toHaveLength(10);
    expect(pull.countDelta).toBe(-2);
  });
});
