/**
 * Composes the upstream feeds and the window predicate into what a page renders.
 *
 * Server-only, because it calls lib/upstream.ts. Every function takes `nowMs`
 * and returns it back as `evaluatedAtMs`, so the render can be stamped with the
 * instant it was actually evaluated at rather than the instant it was viewed.
 */

import 'server-only';

import { evaluateWindow, countUsable, type WindowResult } from './windows';
import {
  fetchSpotSightings,
  fetchTideSeries,
  resolveSpotSwell,
  UpstreamError,
  type SpotSwell,
} from './upstream';
import { swellCeilingFor, type SwellCeiling } from './thresholds';
import { findExtrema, sliceSeries, type TideExtremum, type TideSeries } from './tide';
import { INAT_WINDOW_DAYS, type InatExclusions, type Sighting } from './inat';
import {
  annotateWithTide,
  newestSightings,
  SIGHTINGS_GALLERY_MAX,
  type AnnotatedSighting,
} from './sightings';
import {
  addLocalDays,
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  tryParseLocalDate,
  type LocalDate,
} from './time';
import {
  DISPLAY_TIME_ZONE,
  SPOT_BY_SLUG,
  SPOTS_WITHOUT_FLOOR,
  TIDEPOOL_SPOTS,
  isTidepoolSpot,
  type TidepoolSpot,
} from '@/shared/spots.generated';

/** Columns in the grid, today inclusive. */
export const HORIZON_DAYS = 7;

/**
 * Extra days of predictions fetched either side of the horizon.
 *
 * A window can open before local midnight, and the sub-floor excursion walk in
 * lib/windows.ts needs samples on both sides of the crossing it interpolates. It
 * throws rather than clamps when the series runs out, so the margin is what keeps
 * the first and last columns honest instead of clipped.
 */
const MARGIN_DAYS_BEFORE = 1;
const MARGIN_DAYS_AFTER = 2;

/**
 * What a grid row says about sightings: one line's worth, and no more.
 *
 * Deliberately not the gallery. This travels to a client component through
 * SpotRow's `detail` prop, and PR #18's lesson is written into
 * components/spot-row.tsx -- anything rendered there is paid for by every
 * reader, including the ones who never open a row. The gallery lives on
 * /spot/[slug], which is also the only place phone readers can reach, because
 * the disclosure does not exist below 600px.
 *
 * `ok` with `totalResults: 0` is an empty reef. `unavailable` is a failed
 * request. They are separate variants so no renderer can print one as the
 * other.
 */
export type SpotSightingsSummary =
  | {
      kind: 'ok';
      windowDays: number;
      /** iNaturalist's own count for the window, not the size of the page fetched. */
      totalResults: number;
      /** The most recent surviving record, or null when none survived. */
      newest: Sighting | null;
    }
  | { kind: 'unavailable'; reason: string; drift: boolean };

export interface SpotRow {
  spot: TidepoolSpot;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  /** One entry per day in the horizon. null where evaluation failed. */
  days: (WindowResult | null)[];
  usableCount: number;
  sightings: SpotSightingsSummary;
}

export interface Notice {
  severity: 'info' | 'warn' | 'drift';
  message: string;
}

export interface GridData {
  evaluatedAtMs: number;
  timeZone: string;
  today: LocalDate;
  days: LocalDate[];
  rows: SpotRow[];
  notices: Notice[];
  /** Set when predictions could not be fetched, in which case rows is empty. */
  failure: { message: string; url: string } | null;
  /** Spots left out for want of a floor, so the page can name them. */
  excludedSpotNames: string[];
}

function horizon(today: LocalDate): LocalDate[] {
  return Array.from({ length: HORIZON_DAYS }, (_, i) => addLocalDays(today, i));
}

/** All prediction series needed by a set of spots, fetched once per station. */
async function loadSeriesByStation(
  spots: readonly TidepoolSpot[],
  today: LocalDate,
): Promise<Map<string, TideSeries>> {
  const stationIds = [...new Set(spots.map((s) => s.tide_station))];
  const beginDate = addLocalDays(today, -MARGIN_DAYS_BEFORE);
  const rangeHours = (HORIZON_DAYS + MARGIN_DAYS_BEFORE + MARGIN_DAYS_AFTER) * 24;

  const entries = await Promise.all(
    stationIds.map(async (id) => [id, await fetchTideSeries(id, beginDate, rangeHours)] as const),
  );
  return new Map(entries);
}

/** Notices a spot's swell resolution earns, phrased for a reader. */
function swellNotices(spot: TidepoolSpot, swell: SpotSwell): Notice[] {
  const notices: Notice[] = [];

  for (const problem of swell.problems) {
    notices.push({ severity: swell.drift ? 'drift' : 'info', message: `${spot.name}: ${problem}` });
  }

  if (swell.substituted && swell.sourceBuoyId) {
    notices.push({
      severity: 'warn',
      message:
        `${spot.name}: swell is coming from fallback buoy ${swell.sourceBuoyId} ` +
        `(${swell.sourceBuoyName}), not its primary. A fallback may be geographically ` +
        'distant and read differently for the same conditions.',
    });
  }

  if (swell.intendedBuoyId && swell.intendedBuoyId !== swell.sourceBuoyId) {
    notices.push({
      severity: 'warn',
      message:
        `${spot.name}: the buoy that should serve this spot is ${swell.intendedBuoyId}, which is ` +
        'marked dead. Any reading shown here is a stand-in.',
    });
  }

  return notices;
}

/**
 * The one-line sightings summary for a row.
 *
 * Shares a cache entry with the spot page's gallery, because both build the
 * identical URL and `next: { revalidate }` keys on it. So the grid's eight
 * requests and a spot page's one are the same eight requests, not nine.
 */
async function loadSightingsSummary(
  spot: TidepoolSpot,
  today: LocalDate,
): Promise<SpotSightingsSummary> {
  const result = await fetchSpotSightings(spot, today);
  if (result.kind === 'unavailable') {
    return { kind: 'unavailable', reason: result.reason, drift: result.drift };
  }
  return {
    kind: 'ok',
    windowDays: result.windowDays,
    totalResults: result.observations.totalResults,
    newest: newestSightings(result.observations.sightings, 1)[0] ?? null,
  };
}

/**
 * Notices a spot's sightings earn.
 *
 * Drift is surfaced; an ordinary failed request is an info note. An EMPTY
 * result earns no notice at all, because it is not a problem -- the section
 * says so itself, in words, where a reader is looking for it.
 */
function sightingsNotices(spot: TidepoolSpot, sightings: SpotSightingsSummary): Notice[] {
  if (sightings.kind === 'ok') return [];
  return [
    {
      severity: sightings.drift ? 'drift' : 'info',
      message: `${spot.name}: ${sightings.reason}`,
    },
  ];
}

/** Evaluate one spot across a set of days, collecting failures rather than throwing. */
function evaluateDays(
  spot: TidepoolSpot,
  series: TideSeries,
  days: readonly LocalDate[],
  swell: SpotSwell,
  ceiling: SwellCeiling,
  nowMs: number,
  notices: Notice[],
): (WindowResult | null)[] {
  return days.map((date) => {
    try {
      return evaluateWindow({
        series,
        date,
        floorFt: spot.tidepool_floor_ft,
        swellCeilingFt: ceiling.ceilingFt,
        currentSwellFt: swell.swellFt,
        nowMs,
        lat: spot.lat,
        lon: spot.lon,
        timeZone: DISPLAY_TIME_ZONE,
      });
    } catch (cause) {
      notices.push({
        severity: 'warn',
        message:
          `${spot.name}, ${date.year}-${date.month}-${date.day}: could not be evaluated. ` +
          (cause instanceof Error ? cause.message : String(cause)),
      });
      return null;
    }
  });
}

/**
 * The whole grid: every spot that carries a floor, across the horizon.
 *
 * Predictions failing is fatal and comes back as `failure`, because with no tide
 * there is nothing to show and an empty grid would read as "nothing on". Swell
 * failing is not fatal: it becomes a null reading, which the predicate turns into
 * `swell-tbd`, which can never render as a pass.
 */
export async function loadGrid(nowMs: number): Promise<GridData> {
  const today = localDateInZone(nowMs, DISPLAY_TIME_ZONE);
  const days = horizon(today);
  const notices: Notice[] = [];

  const base = {
    evaluatedAtMs: nowMs,
    timeZone: DISPLAY_TIME_ZONE,
    today,
    days,
    excludedSpotNames: SPOTS_WITHOUT_FLOOR.map((s) => s.name),
  };

  let seriesByStation: Map<string, TideSeries>;
  try {
    seriesByStation = await loadSeriesByStation(TIDEPOOL_SPOTS, today);
  } catch (cause) {
    return {
      ...base,
      rows: [],
      notices,
      failure: {
        message: cause instanceof Error ? cause.message : String(cause),
        url: cause instanceof UpstreamError ? cause.url : '',
      },
    };
  }

  const rows = await Promise.all(
    TIDEPOOL_SPOTS.map(async (spot): Promise<SpotRow> => {
      // Swell and sightings are independent upstreams, so they go out together
      // rather than one behind the other. Neither can fail the row.
      const [swell, sightings] = await Promise.all([
        resolveSpotSwell(spot, nowMs),
        loadSightingsSummary(spot, today),
      ]);
      const ceiling = swellCeilingFor(spot.slug);
      const series = seriesByStation.get(spot.tide_station)!;

      const evaluated = evaluateDays(spot, series, days, swell, ceiling, nowMs, notices);

      return {
        spot,
        swell,
        ceiling,
        days: evaluated,
        usableCount: countUsable(evaluated.filter((d): d is WindowResult => d !== null)),
        sightings,
      };
    }),
  );

  for (const row of rows) {
    notices.push(...swellNotices(row.spot, row.swell));
    notices.push(...sightingsNotices(row.spot, row.sightings));
  }

  return { ...base, rows, notices, failure: null };
}

/* ===========================================================================
 * Single spot
 * ========================================================================= */

/**
 * The gallery, which only /spot/[slug] renders.
 *
 * Separate from SpotSightingsSummary rather than an extension of it, because
 * the grid must not be able to reach this by accident: it is eight photos'
 * worth of markup and the grid pays for its `detail` on every request.
 */
export type SpotSightingsGallery =
  | {
      kind: 'ok';
      windowDays: number;
      totalResults: number;
      /** Records on the page fetched, before this app's own exclusions. */
      fetchedCount: number;
      /** Surviving records the gallery could have drawn from. */
      usableCount: number;
      excluded: InatExclusions;
      /** The newest few, with their tide. Never filtered by whether a photo renders. */
      shown: AnnotatedSighting[];
    }
  | { kind: 'unavailable'; reason: string; drift: boolean };

export interface SpotWeek extends SpotRow {
  evaluatedAtMs: number;
  timeZone: string;
  today: LocalDate;
  days: (WindowResult | null)[];
  dates: LocalDate[];
  notices: Notice[];
  failure: { message: string; url: string } | null;
  gallery: SpotSightingsGallery;
}

/** Resolve a slug to a spot the grid can actually evaluate, or null. */
export function tidepoolSpotBySlug(slug: string): TidepoolSpot | null {
  const spot = SPOT_BY_SLUG[slug as keyof typeof SPOT_BY_SLUG];
  if (!spot) return null;
  // A spot with no floor is not evaluable. Returning null rather than guessing a
  // floor is the whole reason the grid is eight spots and not twenty-six.
  return isTidepoolSpot(spot) ? spot : null;
}

/* ===========================================================================
 * What the day route will answer for
 * ========================================================================= */

/**
 * How far either side of today `/spot/[slug]/[date]` will serve.
 *
 * This is NOT a claim about where the maths stops holding. Tide predictions are
 * astronomical and CO-OPS serves them across roughly 130 years: `1900-01-01`
 * rendered a full chart with four turning points and a low of -1.5 ft at
 * 3:22 pm, and every one of those numbers was a real harmonic answer.
 *
 * It is a claim about what this app will spend someone else's bandwidth on.
 * Each distinct date is a distinct CO-OPS request, every day page links to the
 * day either side of it, and none of it is statically cached -- an unbounded
 * crawl chain pointed at an upstream, about 380,000 pages of it. A repo built
 * around not leaning on sources that quietly rot should not also be the thing
 * leaning on them.
 *
 * The bounds are asymmetric because the use is. Looking a year ahead at a
 * spring tide is a real thing to want, and loadSpotDay deliberately fetches
 * around the requested date rather than reusing the grid's range precisely so
 * that a deep link past the 7-day horizon works. Looking backwards is mostly
 * checking what last weekend did. 30 back and 365 forward leaves ~2,900 pages
 * per spot rather than ~48,000.
 */
export const SERVABLE_DAYS_BEFORE = 30;
export const SERVABLE_DAYS_AFTER = 365;

/** Whether the day route will answer for `date`, given the local day it is now. */
export function isServableDate(date: LocalDate, today: LocalDate): boolean {
  const offset = localDaysBetween(today, date);
  return offset >= -SERVABLE_DAYS_BEFORE && offset <= SERVABLE_DAYS_AFTER;
}

/**
 * Resolve a `[date]` route segment to a date this app will serve, or null.
 *
 * Two rejections, both about untrusted input, and they are different failures.
 *
 * The parse refuses anything that is not exactly YYYY-MM-DD or that does not
 * round-trip: `2026-02-30` parses as a Date in JS and rolls to 2 March, which
 * would chart a different day than the URL names.
 *
 * The range check then refuses a date outside the servable window. Callers run
 * this BEFORE loadSpotDay, which is the whole point -- an out-of-range request
 * costs a 404 and no upstream request at all, so a crawler walking the prev/next
 * chain stops at the boundary and CO-OPS never hears about it.
 */
export function servableDateParam(dateParam: string, nowMs: number): LocalDate | null {
  const date = tryParseLocalDate(dateParam);
  if (!date) return null;
  return isServableDate(date, localDateInZone(nowMs, DISPLAY_TIME_ZONE)) ? date : null;
}

export async function loadSpotWeek(spot: TidepoolSpot, nowMs: number): Promise<SpotWeek> {
  const today = localDateInZone(nowMs, DISPLAY_TIME_ZONE);
  const dates = horizon(today);
  const notices: Notice[] = [];
  const ceiling = swellCeilingFor(spot.slug);

  const [swell, sightings, gallery] = await Promise.all([
    resolveSpotSwell(spot, nowMs),
    loadSightingsSummary(spot, today),
    loadSpotGallery(spot, today),
  ]);
  notices.push(...sightingsNotices(spot, sightings));

  const shell = {
    evaluatedAtMs: nowMs,
    timeZone: DISPLAY_TIME_ZONE,
    today,
    dates,
    spot,
    swell,
    ceiling,
    sightings,
    gallery,
  };

  let series: TideSeries;
  try {
    series = (await loadSeriesByStation([spot], today)).get(spot.tide_station)!;
  } catch (cause) {
    return {
      ...shell,
      days: dates.map(() => null),
      usableCount: 0,
      notices,
      failure: {
        message: cause instanceof Error ? cause.message : String(cause),
        url: cause instanceof UpstreamError ? cause.url : '',
      },
    };
  }

  const days = evaluateDays(spot, series, dates, swell, ceiling, nowMs, notices);
  notices.push(...swellNotices(spot, swell));

  return {
    ...shell,
    days,
    usableCount: countUsable(days.filter((d): d is WindowResult => d !== null)),
    notices,
    failure: null,
  };
}

/**
 * The gallery, with each sighting's tide attached.
 *
 * This needs a SECOND prediction series. The grid's fetch starts one day before
 * today; the sightings window reaches fourteen days back, and `heightAt` throws
 * outside its series rather than clamping to the end -- which is the behaviour
 * to want, and the reason a separate fetch is the honest fix rather than
 * catching the throw. The two requests are distinct URLs and cache
 * independently, and CO-OPS serves a year of 6-minute predictions per request,
 * so sixteen days is not a cost worth optimising away.
 *
 * A failed prediction fetch does NOT take out the gallery. The sightings still
 * render; they render without tide heights, each carrying the reason.
 */
async function loadSpotGallery(
  spot: TidepoolSpot,
  today: LocalDate,
): Promise<SpotSightingsGallery> {
  const result = await fetchSpotSightings(spot, today);
  if (result.kind === 'unavailable') {
    return { kind: 'unavailable', reason: result.reason, drift: result.drift };
  }

  const { observations } = result;

  let series: TideSeries | null = null;
  if (observations.sightings.length > 0) {
    try {
      series = await fetchTideSeries(
        spot.tide_station,
        addLocalDays(today, -(INAT_WINDOW_DAYS + 1)),
        (INAT_WINDOW_DAYS + 2) * 24,
      );
    } catch {
      // Reported per sighting by annotateWithTide, in the place a reader is
      // looking for the missing number rather than in a notice at the bottom.
      series = null;
    }
  }

  return {
    kind: 'ok',
    windowDays: result.windowDays,
    totalResults: observations.totalResults,
    fetchedCount: observations.fetchedCount,
    usableCount: observations.sightings.length,
    excluded: observations.excluded,
    shown: annotateWithTide(
      newestSightings(observations.sightings, SIGHTINGS_GALLERY_MAX),
      series,
    ),
  };
}

/* ===========================================================================
 * Single day
 * ========================================================================= */

export interface SpotDay {
  spot: TidepoolSpot;
  date: LocalDate;
  today: LocalDate;
  evaluatedAtMs: number;
  timeZone: string;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  window: WindowResult | null;
  /** 6-minute samples for the local day, for the chart. */
  daySeries: TideSeries;
  /**
   * Every extremum of the local day. The corridor is mixed semidiurnal, so this
   * is normally four -- two highs and two lows of unequal size.
   */
  extrema: TideExtremum[];
  dayStartMs: number;
  dayEndMs: number;
  notices: Notice[];
  failure: { message: string; url: string } | null;
}

export async function loadSpotDay(
  spot: TidepoolSpot,
  date: LocalDate,
  nowMs: number,
): Promise<SpotDay> {
  const today = localDateInZone(nowMs, DISPLAY_TIME_ZONE);
  const notices: Notice[] = [];
  const ceiling = swellCeilingFor(spot.slug);
  const swell = await resolveSpotSwell(spot, nowMs);
  const { startMs: dayStartMs, endMs: dayEndMs } = localDayBounds(date, DISPLAY_TIME_ZONE);

  const emptySeries: TideSeries = {
    stationId: spot.tide_station,
    datum: 'MLLW',
    units: 'ft',
    timeZone: 'UTC',
    samples: [],
    uniformStepMs: null,
  };

  const shell = {
    spot,
    date,
    today,
    evaluatedAtMs: nowMs,
    timeZone: DISPLAY_TIME_ZONE,
    swell,
    ceiling,
    dayStartMs,
    dayEndMs,
  };

  /*
   * The requested date may sit outside the horizon the grid fetched -- someone can
   * type any date into the URL. Fetch a window centred on the requested date
   * instead of reusing the grid's range, so a deep link to next month works.
   */
  let series: TideSeries;
  try {
    series = await fetchTideSeries(
      spot.tide_station,
      addLocalDays(date, -MARGIN_DAYS_BEFORE),
      (1 + MARGIN_DAYS_BEFORE + MARGIN_DAYS_AFTER) * 24,
    );
  } catch (cause) {
    return {
      ...shell,
      window: null,
      daySeries: emptySeries,
      extrema: [],
      notices,
      failure: {
        message: cause instanceof Error ? cause.message : String(cause),
        url: cause instanceof UpstreamError ? cause.url : '',
      },
    };
  }

  const [window] = evaluateDays(spot, series, [date], swell, ceiling, nowMs, notices);
  notices.push(...swellNotices(spot, swell));

  const daySeries = sliceSeries(series, dayStartMs, dayEndMs);
  const extrema = findExtrema(series).filter((e) => e.tMs >= dayStartMs && e.tMs < dayEndMs);

  return {
    ...shell,
    window: window ?? null,
    daySeries,
    extrema,
    notices,
    failure: null,
  };
}

/* ===========================================================================
 * Row order
 * ========================================================================= */

export type SortKey = 'usable' | 'geographic';

/**
 * How close this spot came to a workable window over the whole horizon.
 *
 * The smallest `low - floor` across the row's days, so a negative value means
 * the tide got under the floor on at least one day and a positive one is the
 * margin by which the best day missed. Null-day entries are skipped; a row with
 * no evaluable day at all returns Infinity and sorts last.
 */
export function bestGapFt(row: SpotRow): number {
  let best = Infinity;
  for (const day of row.days) {
    if (!day) continue;
    const gap = day.lowFt - day.floorFt;
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * Order the grid's rows.
 *
 * Lived in app/page.tsx until the tie-break below made it worth testing.
 *
 * ---------------------------------------------------------------------------
 * Why the tie-break exists
 * ---------------------------------------------------------------------------
 *
 * `usable` sorted by usable count, then by how much window today had left, then
 * by name. All eight spots share tide station 9410230, so today's remaining
 * minutes are identical across every row -- and in a week where nothing clears
 * the floor every usable count is 0 as well. Both keys tied on every
 * comparison and the whole sort fell through to `localeCompare`. The control
 * rendered alphabetical order and called it "Usable windows".
 *
 * The floor is the one thing that genuinely differs per spot, so when the
 * counts tie the rows are ranked by how close each got to its own floor.
 *
 * The direction is easy to get backwards, so: a HIGHER tidepool_floor_ft is
 * more PERMISSIVE. It means the stack calls the reef workable at higher water.
 * spots.json states this in its own unresolved array -- the 1.2.0 shift "moved
 * every floor in the PERMISSIVE direction", and Sunset Cliffs at 0.7 ft is
 * "deliberately kept the strictest of the eight".
 *
 * So against one shared tide, Cabrillo at 1.3 ft ranks first and Sunset Cliffs
 * at 0.7 ft ranks last, because Cabrillo is the one nearest to a window.
 *
 * The remaining-minutes key is kept after it. It decides nothing while one
 * station serves every spot, but it is correct on its own terms and would start
 * mattering again the moment a spot binds to a different station.
 */
export function sortRows(rows: readonly SpotRow[], sort: SortKey): SpotRow[] {
  if (sort === 'geographic') {
    // spots.json is already ordered north to south, from Oceanside Harbour down
    // to Border Field, and TIDEPOOL_SPOTS preserves that order. Geographic sort
    // is the file's own order -- deriving it from latitude again would be a
    // second source of truth that could disagree with the file.
    return [...rows];
  }

  return [...rows].sort((a, b) => {
    if (b.usableCount !== a.usableCount) return b.usableCount - a.usableCount;

    const aGap = bestGapFt(a);
    const bGap = bestGapFt(b);
    if (aGap !== bGap) return aGap - bGap;

    const aToday = a.days[0]?.minutesRemaining ?? a.days[0]?.usableMinutes ?? 0;
    const bToday = b.days[0]?.minutesRemaining ?? b.days[0]?.usableMinutes ?? 0;
    if (bToday !== aToday) return bToday - aToday;

    return a.spot.name.localeCompare(b.spot.name);
  });
}
