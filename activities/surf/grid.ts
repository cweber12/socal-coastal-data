/**
 * Composes the upstream feeds and the band predicate into what a page renders.
 *
 * Server-only, because it calls core/upstream.ts. Every function takes `nowMs`
 * and returns it back as `evaluatedAtMs`, so the render can be stamped with the
 * instant it was actually evaluated at rather than the instant it was viewed.
 *
 * ---------------------------------------------------------------------------
 * What this copy of activities/tidepool/grid.ts does NOT carry
 * ---------------------------------------------------------------------------
 *
 * iNaturalist. Every sightings path in tidepool's grid -- the row summary, the
 * gallery, the second prediction series fetched to put a tide against each
 * observation -- is about what is living on an exposed reef, and there is no
 * surf equivalent to fetch. Copying the shape and leaving it empty would have
 * put three upstream calls per row behind a section that could never say
 * anything.
 *
 * The calibration pipeline is absent for the same reason and a stronger one:
 * shared/calibration.json bins sighting rates against the day's lowest low, and
 * a marginal rate of finding a nudibranch has no bearing on whether a wave is
 * rideable. #135 is where surf's own evidence would come from, and it is not
 * this.
 *
 * What DID come across unchanged is the failure policy: predictions fatal, swell
 * not, drift surfaced, substitution disclosed. That is core's, it is right, and
 * it is the part #130 should be looking at.
 */

import 'server-only';

import { countUsable, evaluateSurfDay, type SurfDay } from './policy';
import { SURF_SWELL_MINIMUM, SURF_TIDE_BAND, swellCeilingFor } from './thresholds';
import { resolveSpotSwell, UpstreamError, fetchTideSeries, type SpotSwell } from '../../core/upstream';
import type { SwellCeiling } from '../../core/thresholds';
import type { Notice } from '../../core/notice';
import { gateWindowFor } from '../../core/spot/access';
import { findExtrema, sliceSeries, type TideExtremum, type TideSeries } from '../../core/feeds/coops-predictions';
import {
  addLocalDays,
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  tryParseLocalDate,
  type LocalDate,
} from '../../core/time';
import {
  SPOTS_OUTSIDE_SURF,
  SURF_ACCOUNTING,
  SURF_SPOTS,
  surfSpotBySlug as zoneSurfSpotBySlug,
  type SurfNonMember,
  type SurfSpot,
} from '../../core/zones/surf';
import { DISPLAY_TIME_ZONE } from '@/shared/spots.generated';

/** Columns in the grid, today inclusive. */
export const HORIZON_DAYS = 7;

/**
 * Extra days of predictions fetched either side of the horizon.
 *
 * A session can open before local midnight and close after it, and the band walk
 * interpolates a crossing against the sample on the far side of it. The walk
 * runs over the whole series and intersects with the local day afterwards --
 * precisely so a session already under way at 00:00 reports `continuesBefore`
 * rather than pretending it began there -- and that only works if the series
 * actually extends past the day.
 */
const MARGIN_DAYS_BEFORE = 1;
const MARGIN_DAYS_AFTER = 2;

export interface SurfRow {
  spot: SurfSpot;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  /** One entry per day in the horizon. null where evaluation failed. */
  days: (SurfDay | null)[];
  usableCount: number;
}

export interface SurfGridData {
  evaluatedAtMs: number;
  timeZone: string;
  today: LocalDate;
  days: LocalDate[];
  rows: SurfRow[];
  notices: Notice[];
  /** Set when predictions could not be fetched, in which case rows is empty. */
  failure: { message: string; url: string } | null;
  /**
   * Spots this grid does not cover, in corridor order, each carrying which
   * bucket it is in and the zone module's own reason.
   */
  excluded: readonly SurfNonMember[];
  /**
   * The three membership counts and the inventory they must sum to, so the page
   * can show that no spot fell down a gap between the grid and the disclosure.
   */
  membership: typeof SURF_ACCOUNTING;
}

function horizon(today: LocalDate): LocalDate[] {
  return Array.from({ length: HORIZON_DAYS }, (_, i) => addLocalDays(today, i));
}

/** All prediction series needed by a set of spots, fetched once per station. */
async function loadSeriesByStation(
  spots: readonly SurfSpot[],
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
function swellNotices(spot: SurfSpot, swell: SpotSwell): Notice[] {
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
  spot: SurfSpot,
  series: TideSeries,
  days: readonly LocalDate[],
  swell: SpotSwell,
  ceiling: SwellCeiling,
  nowMs: number,
  notices: Notice[],
): (SurfDay | null)[] {
  return days.map((date) => {
    try {
      return evaluateSurfDay({
        series,
        date,
        band: { minFt: SURF_TIDE_BAND.minFt, maxFt: SURF_TIDE_BAND.maxFt },
        swellCeilingFt: ceiling.ceilingFt,
        swellMinimumFt: SURF_SWELL_MINIMUM.ft,
        currentSwellFt: swell.swellFt,
        nowMs,
        lat: spot.lat,
        lon: spot.lon,
        timeZone: DISPLAY_TIME_ZONE,
        // null for every spot with no operator gate, which is 25 of 26.
        gate: gateWindowFor(spot.slug, date, DISPLAY_TIME_ZONE),
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
 * The whole grid: every surf-zone spot, across the horizon.
 *
 * Predictions failing is fatal and comes back as `failure`, because with no tide
 * there is nothing to show and an empty grid would read as "nothing on". Swell
 * failing is not fatal: it becomes a null reading, which the predicate turns into
 * `swell-tbd`, which can never render as a pass.
 */
export async function loadSurfGrid(nowMs: number): Promise<SurfGridData> {
  const today = localDateInZone(nowMs, DISPLAY_TIME_ZONE);
  const days = horizon(today);
  const notices: Notice[] = [];

  const base = {
    evaluatedAtMs: nowMs,
    timeZone: DISPLAY_TIME_ZONE,
    today,
    days,
    excluded: SPOTS_OUTSIDE_SURF,
    membership: SURF_ACCOUNTING,
  };

  let seriesByStation: Map<string, TideSeries>;
  try {
    seriesByStation = await loadSeriesByStation(SURF_SPOTS, today);
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
    SURF_SPOTS.map(async (spot): Promise<SurfRow> => {
      const swell = await resolveSpotSwell(spot, nowMs);
      const ceiling = swellCeilingFor(spot.slug);
      const series = seriesByStation.get(spot.tide_station)!;

      const evaluated = evaluateDays(spot, series, days, swell, ceiling, nowMs, notices);

      return {
        spot,
        swell,
        ceiling,
        days: evaluated,
        usableCount: countUsable(evaluated.filter((d): d is SurfDay => d !== null)),
      };
    }),
  );

  for (const row of rows) {
    notices.push(...swellNotices(row.spot, row.swell));
  }

  return { ...base, rows, notices, failure: null };
}

/* ===========================================================================
 * Single spot
 * ========================================================================= */

/**
 * Resolve a slug to a spot this activity can evaluate, or null.
 *
 * Surfing reads the surf zone, so a spot this activity can evaluate is a member
 * of that zone -- the question is the zone's to answer and this is a one-line
 * delegation to it, exactly as tidepool delegates to the intertidal.
 */
export function surfSpotBySlug(slug: string): SurfSpot | null {
  return zoneSurfSpotBySlug(slug);
}

/* ===========================================================================
 * What the day route will answer for
 * ========================================================================= */

/**
 * How far either side of today `/surf/<slug>/<date>` will serve.
 *
 * Not a claim about where the maths stops holding -- tide predictions are
 * astronomical and CO-OPS serves them across roughly 130 years. It is a claim
 * about what this app will spend someone else's bandwidth on: each distinct date
 * is a distinct CO-OPS request, every day page links to the day either side of
 * it, and none of it is statically cached.
 *
 * The same 30/365 tidepool uses, and the arithmetic is worse here because there
 * are 24 surf-zone spots against 8 intertidal ones. 30 back and 365 forward
 * leaves ~2,900 pages per spot rather than ~48,000, so the unbounded crawl chain
 * would have been ~1.25 million pages across this activity alone.
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
 * Two rejections, both about untrusted input. The parse refuses anything that is
 * not exactly YYYY-MM-DD or that does not round-trip: `2026-02-30` parses as a
 * Date in JS and rolls to 2 March, which would chart a different day than the URL
 * names. The range check then refuses a date outside the servable window, and
 * callers run this BEFORE loadSurfSpotDay so an out-of-range request costs a 404
 * and no upstream request at all.
 */
export function servableDateParam(dateParam: string, nowMs: number): LocalDate | null {
  const date = tryParseLocalDate(dateParam);
  if (!date) return null;
  return isServableDate(date, localDateInZone(nowMs, DISPLAY_TIME_ZONE)) ? date : null;
}

/* ===========================================================================
 * Single day
 * ========================================================================= */

export interface SurfSpotDay {
  spot: SurfSpot;
  date: LocalDate;
  today: LocalDate;
  evaluatedAtMs: number;
  timeZone: string;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  day: SurfDay | null;
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

export async function loadSurfSpotDay(
  spot: SurfSpot,
  date: LocalDate,
  nowMs: number,
): Promise<SurfSpotDay> {
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
   * The requested date may sit outside the horizon the grid fetched -- someone
   * can type any date into the URL. Fetch a window centred on the requested date
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
      day: null,
      daySeries: emptySeries,
      extrema: [],
      notices,
      failure: {
        message: cause instanceof Error ? cause.message : String(cause),
        url: cause instanceof UpstreamError ? cause.url : '',
      },
    };
  }

  const [evaluated] = evaluateDays(spot, series, [date], swell, ceiling, nowMs, notices);
  notices.push(...swellNotices(spot, swell));

  const daySeries = sliceSeries(series, dayStartMs, dayEndMs);
  const extrema = findExtrema(series).filter((e) => e.tMs >= dayStartMs && e.tMs < dayEndMs);

  return {
    ...shell,
    day: evaluated ?? null,
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
 * Total usable session minutes across the horizon, for the sort tie-break.
 *
 * The surf analogue of tidepool's `bestGapFt`, and it exists for the same
 * reason that one does: every surf-zone spot binds tide station 9410230 except
 * none -- all 24 do -- so every row of the grid sees the same tide, every
 * session is at the same clock time, and the usable counts tie constantly. What
 * differs per spot is the CEILING, which is 3.0 ft everywhere except Black's at
 * 2.0 and Tourmaline at 4.0.
 *
 * That means on most weeks this key ties too, and the sort falls through to
 * name. Saying so is the point: a control labelled "Usable days" that renders
 * alphabetical order is the bug #101's grid sort already shipped once, and the
 * honest fix is a key that genuinely varies rather than one that looks like it
 * might. Minutes vary the moment a spot's ceiling or gate differs, and they are
 * the number a reader would rank by if asked.
 */
export function usableMinutes(row: SurfRow): number {
  let total = 0;
  for (const day of row.days) {
    if (!day) continue;
    for (const session of day.windows) total += session.usableMinutes;
  }
  return total;
}

/** Order the grid's rows. */
export function sortRows(rows: readonly SurfRow[], sort: SortKey): SurfRow[] {
  if (sort === 'geographic') {
    // spots.json is already ordered north to south, and core/zones/surf.ts
    // preserves that order by walking SPOTS rather than re-deriving it from
    // latitude. Geographic sort is the file's own order.
    return [...rows];
  }

  return [...rows].sort((a, b) => {
    if (b.usableCount !== a.usableCount) return b.usableCount - a.usableCount;

    const aMinutes = usableMinutes(a);
    const bMinutes = usableMinutes(b);
    if (bMinutes !== aMinutes) return bMinutes - aMinutes;

    return a.spot.name.localeCompare(b.spot.name);
  });
}
