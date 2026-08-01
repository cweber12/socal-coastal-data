/**
 * Surf's judgement: a tide band, a two-sided swell window, and which session the
 * day is about. Pure: no network, no ambient clock -- `now` is passed in, so
 * every state is reproducible from its inputs.
 *
 * The question: given a day's tide predictions, WHEN is the tide inside the
 * workable band, and if it never is, why not.
 *
 * ===========================================================================
 * What this owns, now that the engine is next door
 * ===========================================================================
 *
 * #129 built this by copying `activities/tidepool/policy.ts` and editing it. The
 * duplication was deliberate and temporary: it is what made #130's extraction
 * evidence-based rather than speculative. The four things that differed are what
 * the extraction had to accommodate, and all four survive -- three of them here
 * and one of them in the solver's shape:
 *
 *   1. N INTERVALS, NOT ONE. In core/window/solve.ts, for both occupants.
 *
 *   2. NO ANCHOR. Also in the solver, and it is the finding that changed the
 *      spec: `solve` reports the turns an interval happens to contain rather
 *      than being told which turn to walk out from. On 2026-07-22 this day's
 *      first session holds a high AND a low while the second holds no turn at
 *      all, so there is no anchor an anchor-first solver could have been given.
 *
 *   3. A TWO-SIDED PREDICATE, `minFt < ft && ft < maxFt`, strict on both edges.
 *      Below, because it is this activity's judgement about what is workable.
 *
 *   4. NO FLOOD-SIDE TRIM. Tidepool trims the flood side to 0.6 because the
 *      water is returning over a reef somebody is standing on and a return route
 *      that was dry can close. That is a fact about being on foot on a ledge
 *      system, not about the tide, and it has no equivalent for someone already
 *      in the water. It stayed in tidepool's policy, where it belongs.
 *
 * The swell horizon, the daylight clip, the gate clip and the minimum-duration
 * rule came across the #129 copy UNCHANGED, and are now in core/window/gates.ts.
 * What #129 also found is that a ceiling alone is not the swell gate: a 0.4 ft
 * reading with the tide in the band read `go`. The gate is a WINDOW, and its
 * lower answer is `flat`.
 */

import { formatThreshold } from '../../core/format';
import type { GateWindow } from '../../core/spot/access';
import { findExtrema, type TideExtremum, type TideSeries } from '../../core/feeds/coops-predictions';
import type { ActivityDay, UsableWindow } from '../../core/window/day';
import {
  assertSeriesCoversDay,
  clipToGates,
  darkReason,
  daylightGate,
  gateClosedReason,
  gateVerdict,
  MIN_USABLE_MINUTES,
  readSwell,
  swellFlatReason,
  swellUnknownReason,
  swellVetoReason,
  SWELL_HORIZON_DAYS,
} from '../../core/window/gates';
import { solve } from '../../core/window/solve';
import {
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  sameLocalDate,
  type LocalDate,
} from '../../core/time';
import { STATE_PRESENTATION, type CellLighting, type SurfState } from './states';

export { SWELL_HORIZON_DAYS };

/* ===========================================================================
 * Constants
 * ========================================================================= */

/**
 * Below this, a session is not worth the drive. Covers parking, getting changed,
 * the paddle out and back.
 *
 * The shared duration gate's default. 45 minutes is tidepool's number for a
 * different activity, carried over as a starting point rather than re-derived,
 * and core/window/gates.ts records that it is a judgement rather than a
 * measurement. This activity passes it explicitly, so calibrating a surf-specific
 * minimum is a one-line change here rather than a change to the gate.
 */
export const MIN_SESSION_MINUTES = MIN_USABLE_MINUTES;

export interface SurfBand {
  /** Tide height below which the spot is out of band. Strict. */
  minFt: number;
  /** Tide height above which the spot is out of band. Strict. */
  maxFt: number;
}

export interface SurfInput {
  /** Prediction series covering at least the whole local day being evaluated. */
  series: TideSeries;
  /** The local calendar day to evaluate. */
  date: LocalDate;
  /** The tide band, in the series units and on the series datum. */
  band: SurfBand;
  /** Significant wave height above which the day is called off. */
  swellCeilingFt: number;
  /** Significant wave height below which there is nothing to ride. */
  swellMinimumFt: number;
  /** Latest swell reading, or null when the buoy is not delivering. */
  currentSwellFt: number | null;
  /** Evaluation instant. Passed in, never read from the host clock. */
  nowMs: number;
  lat: number;
  lon: number;
  /** Zone the calendar day is expressed in. */
  timeZone: string;
  /**
   * Operator gate for this spot on this day, or null where the spot has no
   * operator. Null for 25 of the 26 spots.
   */
  gate?: GateWindow | null;
}

/**
 * This activity's word for a window.
 *
 * The shape is `core/window/day.ts`'s `UsableWindow` exactly -- the engine
 * produces it, and calling it a session here is vocabulary rather than a second
 * type. The cell face says "2 sessions" because that is what a surfer calls
 * them; the grid's shared shape says `windows` because that is what every
 * activity has.
 */
export type SurfSession = UsableWindow;

/** Everything about a surf day that only surf can answer. */
export interface SurfDetail {
  /**
   * The session this day's verdict is about, or null when there are none.
   *
   * The longest by decisive minutes -- remaining time on today, usable time on
   * any other day -- then by usable minutes, then earliest. NOT "the next one",
   * which is what tidepool reports: tidepool has one window a day and the
   * question is how much of it is left, while a surf day routinely offers a dawn
   * session and an evening one and the useful answer is the better of them.
   */
  best: SurfSession | null;

  /** Every turning point of the local day, in time order. Normally four. */
  extrema: TideExtremum[];
  /** The day's lowest and highest predicted heights, for the cell face. */
  dayLowFt: number;
  dayHighFt: number;

  band: SurfBand;
}

/**
 * Narrowed on `swellMinimumFt`: this activity always declares one, so the shared
 * shape's "null where swell is a hazard only" is not a case surf's UI has to
 * handle.
 */
export type SurfDay = ActivityDay<SurfState, SurfDetail> & { swellMinimumFt: number };

/* ===========================================================================
 * Evaluation
 * ========================================================================= */

/** The one caveat a surf day can carry today. */
const SERIES_CLIPPED_NOTE =
  'The session runs past the end of the prediction series, so this length is a minimum.';

/**
 * Evaluate one spot on one local day.
 *
 * Throws when a band edge is not finite, or when the band is empty. An empty
 * band produces `out-of-band` on every spot on every day, which renders as an
 * ordinary quiet week rather than as the configuration error it is.
 */
export function evaluateSurfDay(input: SurfInput): SurfDay {
  const {
    series,
    date,
    band,
    swellCeilingFt,
    swellMinimumFt,
    currentSwellFt,
    nowMs,
    lat,
    lon,
    timeZone,
    gate = null,
  } = input;

  if (!Number.isFinite(band.minFt) || !Number.isFinite(band.maxFt)) {
    throw new Error(
      'evaluateSurfDay: both band edges must be finite numbers. A null edge is ' +
        'unresolved, and guessing one produces a confident state for a spot whose ' +
        'workable tide range nobody has established.',
    );
  }
  if (!(band.minFt < band.maxFt)) {
    throw new Error(
      `evaluateSurfDay: the band [${band.minFt}, ${band.maxFt}] is empty. No tide can be ` +
        'inside it, so every day would read out-of-band and look like an ordinary flat week.',
    );
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = localDayBounds(date, timeZone);

  const today = localDateInZone(nowMs, timeZone);
  const isToday = sameLocalDate(today, date);
  const daysFromToday = localDaysBetween(today, date);

  // Two-sided, because a ceiling alone called a flat day `go`. See gates.ts.
  const swell = readSwell(currentSwellFt, daysFromToday, {
    ceilingFt: swellCeilingFt,
    minimumFt: swellMinimumFt,
  });

  assertSeriesCoversDay('evaluateSurfDay', series, date, timeZone, dayStartMs, dayEndMs);

  const { sunriseMs, sunsetMs } = daylightGate(lat, lon, date, dayStartMs, dayEndMs);

  /* -----------------------------------------------------------------------
   * The band predicate.
   *
   * BOTH EDGES ARE STRICT, and that is a decision rather than a default. A
   * sample sitting exactly ON an edge is out of band, which matches tidepool's
   * `ft < floorFt` and, more importantly, matches what the number means: the
   * band is where the tide is workable, and its edge is where it stops being.
   *
   * This is not a hypothetical case. In the committed 384-hour fixture for
   * station 9410230 -- 3,841 samples -- exactly one reads `1.5`, at 22:36 PDT on
   * 2026-07-21, sitting precisely on the lower edge. Predictions are quoted to
   * three decimals and band edges to one, so an exact tie is not exotic; it is
   * rare enough that a solver which gets it wrong will look right for weeks.
   * Strictness makes that sample the first sample OUT, and the exit crossing
   * interpolates to it exactly. core/window/solve.ts carries the regression test.
   *
   * `edgeFrom` reads the crossed edge off the OUT sample rather than inferring
   * it from the direction of travel. At or below the minimum it crossed the
   * minimum; at or above the maximum it crossed the maximum. The two are
   * exhaustive because "out of band" has only those two ways of being true, and
   * using the out sample means the exactly-on case picks its own edge instead of
   * falling through a direction test.
   * --------------------------------------------------------------------- */
  const intervals = solve(
    series,
    {
      holds: (ft) => band.minFt < ft && ft < band.maxFt,
      edgeFrom: (outFt) => (outFt <= band.minFt ? band.minFt : band.maxFt),
    },
    { startMs: dayStartMs, endMs: dayEndMs },
  );

  const gateContext = { sunriseMs, sunsetMs, gate, nowMs, isToday };
  const sessions: SurfSession[] = [];

  for (const run of intervals) {
    // Keep only what falls inside the local day. Half-open on the end, matching
    // every other local-day filter in this repo.
    const startMs = Math.max(run.openMs, dayStartMs);
    const endMs = Math.min(run.closeMs, dayEndMs);
    if (endMs <= startMs) continue;

    sessions.push({
      startMs,
      endMs,
      continuesBefore: run.continuesBefore,
      continuesAfter: run.continuesAfter,
      seriesClipped: run.seriesClipped,
      anchors: run.anchors.filter((e) => e.tMs >= startMs && e.tMs <= endMs),
      ...clipToGates(startMs, endMs, gateContext),
    });
  }

  const samples = series.samples;
  const extrema = findExtrema(series).filter((e) => e.tMs >= dayStartMs && e.tMs < dayEndMs);
  const decisiveOf = (s: SurfSession) => (isToday ? (s.minutesRemaining ?? 0) : s.usableMinutes);

  /*
   * The day's best session: most decisive minutes, then most usable minutes,
   * then earliest.
   *
   * The second key is not a tidy-up. On today, after the last session has shut,
   * EVERY session has zero minutes remaining -- so a rule of "most decisive
   * minutes, earliest wins" picks whichever session happened to come first,
   * which on an ordinary corridor day is a 1½-hour stretch at 1 a.m. with no
   * daylight in it. The day page then reported "best: none usable" for a day
   * that had offered five and a half hours in the afternoon, which is a false
   * statement about the day made out of a true one about the clock.
   *
   * Falling through to usable minutes makes the panel report on the DAY once the
   * day is over, while `bestMinutes` below still drives the state off decisive
   * minutes and correctly says `dark`. "The best session was 1:32-7:23 pm, and
   * there is nothing left of it" is both facts; the old rule had neither.
   *
   * `sessions` is in time order because the solver's intervals are, so keeping
   * only strict improvements gives the earliest of equals without a third key.
   */
  let best: SurfSession | null = null;
  for (const session of sessions) {
    if (best === null) {
      best = session;
      continue;
    }
    const byDecisive = decisiveOf(session) - decisiveOf(best);
    if (byDecisive > 0 || (byDecisive === 0 && session.usableMinutes > best.usableMinutes)) {
      best = session;
    }
  }

  const dayHeights = samples.filter((s) => s.tMs >= dayStartMs && s.tMs < dayEndMs).map((s) => s.ft);
  const dayLowFt = dayHeights.length > 0 ? Math.min(...dayHeights) : NaN;
  const dayHighFt = dayHeights.length > 0 ? Math.max(...dayHeights) : NaN;

  /* -----------------------------------------------------------------------
   * State, in precedence order. `out-of-band` first, then the gates.
   * --------------------------------------------------------------------- */
  const bestMinutes = best ? decisiveOf(best) : 0;
  const bandText = `${formatThreshold(band.minFt)}–${formatThreshold(band.maxFt)} ft`;

  // The clause every gate sentence is built on. Surf's shape is a LIST, so the
  // subject is plural where tidepool's is singular.
  const TIDE_WORKS = 'The tide is in the band';
  const SUBJECT = 'every session falls';

  let state: SurfState;
  let reason: string;

  if (sessions.length === 0) {
    state = 'out-of-band';
    /*
     * WHICH SIDE, always. Tidepool's `above-floor` has only one direction -- the
     * reef stays covered -- and this has two. A day that never gets under 3.5 ft
     * and a day that never gets over 1.5 ft are opposite problems and a reader
     * planning a week needs to know which they are looking at. A day that stays
     * entirely on one side is the common case; a day that jumps the band without
     * a sample inside it cannot happen at 6-minute spacing over a 2 ft band.
     */
    const staysAbove = dayLowFt >= band.maxFt;
    const staysBelow = dayHighFt <= band.minFt;
    reason = staysAbove
      ? `The tide never drops into the ${bandText} band — the day's lowest is ` +
        `${dayLowFt.toFixed(1)} ft, above the top of it.`
      : staysBelow
        ? `The tide never rises into the ${bandText} band — the day's highest is ` +
          `${dayHighFt.toFixed(1)} ft, below the bottom of it.`
        : `The tide never sits inside the ${bandText} band for long enough to sample, ` +
          `between a low of ${dayLowFt.toFixed(1)} ft and a high of ${dayHighFt.toFixed(1)} ft.`;
  } else {
    state = gateVerdict({
      decisiveMinutes: bestMinutes,
      gateBlocked: sessions.some((s) => s.gateBlocked),
      swell,
      minimumMinutes: MIN_SESSION_MINUTES,
    });

    switch (state) {
      case 'closed':
        reason = gateClosedReason(gate!, timeZone, TIDE_WORKS, SUBJECT);
        break;
      case 'dark':
        reason = darkReason(isToday, TIDE_WORKS, TIDE_WORKS, SUBJECT);
        break;
      case 'veto':
        reason = swellVetoReason(swell.ft!, swellCeilingFt);
        break;
      case 'flat':
        reason = swellFlatReason(swell.ft!, swellMinimumFt, 'The tide works');
        break;
      case 'brief':
        reason =
          `The longest session is ${Math.round(bestMinutes)} min, under the ` +
          `${MIN_SESSION_MINUTES} min minimum` +
          (sessions.length > 1 ? ` — ${sessions.length} sessions, none of them longer.` : '.');
        break;
      case 'swell-tbd':
        // "flat" rather than "calm": this activity reads swell in both
        // directions, so the assumption a reader would otherwise make about a
        // missing number is that there is nothing there.
        reason = swellUnknownReason(swell, 'flat');
        break;
      default:
        reason =
          `${Math.round(bestMinutes)} min of daylight session with the tide in the ` +
          `${bandText} band and swell at ${swell.ft!.toFixed(1)} ft` +
          (sessions.length > 1 ? `, the best of ${sessions.length} today.` : '.');
    }
  }

  const disclosures = best?.seriesClipped && state !== 'out-of-band' ? [SERIES_CLIPPED_NOTE] : [];

  return {
    state,
    date,
    isToday,
    daysFromToday,
    windows: sessions,
    sunriseMs,
    sunsetMs,
    swellFt: swell.known ? swell.ft : null,
    swellKnown: swell.known,
    swellCeilingFt,
    swellMinimumFt,
    reason: [reason, ...disclosures].join(' '),
    disclosures,
    detail: { best, extrema, dayLowFt, dayHighFt, band },
  };
}

/**
 * Whether a session falls in daylight, for the cell background.
 *
 * Measured at the session's MIDPOINT rather than at its start. A tidepool cell
 * reports one instant -- the low -- and shades on that; a surf session is an
 * interval that can open before sunrise and run well into the morning, and
 * shading it on its start would call a 5:30 a.m. to 9:00 a.m. session a night
 * session. The midpoint is the least wrong single answer for an interval, and
 * the times themselves are printed next to it either way.
 */
export function sessionLighting(session: SurfSession, day: SurfDay): CellLighting {
  const middleMs = session.startMs + (session.endMs - session.startMs) / 2;
  return middleMs >= day.sunriseMs && middleMs <= day.sunsetMs ? 'day' : 'night';
}

/** How many of a spot's days are usable. Drives the default sort. */
export function countUsable(results: readonly SurfDay[]): number {
  return results.filter((r) => STATE_PRESENTATION[r.state].usable).length;
}

/** Total sessions across a set of days, for the row summary. */
export function countSessions(results: readonly SurfDay[]): number {
  return results.reduce((total, day) => total + day.windows.length, 0);
}
