/**
 * Composes the upstream feeds and the window predicate into what a page renders.
 *
 * Server-only, because it calls lib/upstream.ts. Every function takes `nowMs`
 * and returns it back as `evaluatedAtMs`, so the render can be stamped with the
 * instant it was actually evaluated at rather than the instant it was viewed.
 */

import 'server-only';

import { evaluateWindow, countUsable, type WindowResult } from './windows';
import { fetchTideSeries, resolveSpotSwell, UpstreamError, type SpotSwell } from './upstream';
import { swellCeilingFor, type SwellCeiling } from './thresholds';
import { findExtrema, sliceSeries, type TideExtremum, type TideSeries } from './tide';
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

export interface SpotRow {
  spot: TidepoolSpot;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  /** One entry per day in the horizon. null where evaluation failed. */
  days: (WindowResult | null)[];
  usableCount: number;
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
      const swell = await resolveSpotSwell(spot, nowMs);
      const ceiling = swellCeilingFor(spot.slug);
      const series = seriesByStation.get(spot.tide_station)!;

      const evaluated = evaluateDays(spot, series, days, swell, ceiling, nowMs, notices);

      return {
        spot,
        swell,
        ceiling,
        days: evaluated,
        usableCount: countUsable(evaluated.filter((d): d is WindowResult => d !== null)),
      };
    }),
  );

  for (const row of rows) notices.push(...swellNotices(row.spot, row.swell));

  return { ...base, rows, notices, failure: null };
}

/* ===========================================================================
 * Single spot
 * ========================================================================= */

export interface SpotWeek extends SpotRow {
  evaluatedAtMs: number;
  timeZone: string;
  today: LocalDate;
  days: (WindowResult | null)[];
  dates: LocalDate[];
  notices: Notice[];
  failure: { message: string; url: string } | null;
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

  const swell = await resolveSpotSwell(spot, nowMs);

  const shell = {
    evaluatedAtMs: nowMs,
    timeZone: DISPLAY_TIME_ZONE,
    today,
    dates,
    spot,
    swell,
    ceiling,
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
