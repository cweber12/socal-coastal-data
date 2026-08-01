/**
 * The band predicate. Pure: no network, no ambient clock -- `now` is passed in,
 * so every state is reproducible from its inputs.
 *
 * The question: given a day's tide predictions, WHEN is the tide inside the
 * workable band, and if it never is, why not.
 *
 * ===========================================================================
 * What this is a copy of, and what changed
 * ===========================================================================
 *
 * activities/tidepool/policy.ts, copied and edited. The duplication is
 * deliberate and temporary: #130 extracts a general solver from two real
 * occupants, and pulling one out of tidepool alone would be guessing at this
 * activity's requirements. Nothing here imports tidepool, and
 * scripts/check-boundaries.mjs fails the moment something tries.
 *
 * Four things had to change, and they are the evidence #130 is waiting on:
 *
 *   1. N INTERVALS, NOT ONE. Tidepool returns a single window anchored on a
 *      single low. A band is crossed four times on an ordinary corridor day and
 *      yields two or three disjoint sessions, so the return is a list and the
 *      day's verdict is an aggregate over it.
 *
 *   2. NO ANCHOR. Tidepool picks a low first and walks outward from it. This
 *      walks the series once and collects every maximal in-band run, then reports
 *      which turns each run happens to contain -- none, one, or two. All three
 *      occur in the committed fixture within a fortnight, which is the finding
 *      that matters: an anchor-first solver has to decide which extremum a
 *      session "belongs to" before it knows whether the session contains one at
 *      all, and on 2026-07-22 the day's second session contains no turn while its
 *      first contains a low, and on 2026-07-21 one session contains both a high
 *      and a low.
 *
 *   3. A TWO-SIDED PREDICATE. `ft < floorFt` becomes `minFt < ft && ft < maxFt`,
 *      strict on both edges. Which edge a run crosses on the way in and on the
 *      way out is no longer implied by the direction of travel, so each is
 *      interpolated against the edge it actually crossed.
 *
 *   4. NO FLOOD-SIDE TRIM. Tidepool trims the flood side to 0.6 because the
 *      water is returning over a reef somebody is standing on and a return route
 *      that was dry can close. That is a fact about being on foot on a ledge
 *      system, not about the tide, and it has no equivalent for someone already
 *      in the water. Copying it would have been the clearest possible case of
 *      generalising one occupant's safety judgement into a solver.
 *
 * The swell horizon, the daylight clip, the gate clip and the minimum-duration
 * rule came across unchanged. That is the other half of the evidence: those four
 * are gate behaviour and belong in core/window/gates.ts.
 */

import { formatThreshold } from '../../core/format';
import type { GateWindow } from '../../core/spot/access';
import { findExtrema, type TideExtremum, type TideSeries } from '../../core/feeds/coops-predictions';
import { daylightBounds } from '../../core/spot/daylight';
import {
  formatClock,
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  sameLocalDate,
  type LocalDate,
} from '../../core/time';
import { STATE_PRESENTATION, type CellLighting, type SurfState } from './states';

/* ===========================================================================
 * Constants
 * ========================================================================= */

/**
 * Below this, a session is not worth the drive. Covers parking, getting changed,
 * the paddle out and back.
 *
 * 45 minutes, which is tidepool's number for a different activity, carried over
 * as a starting point rather than re-derived. It sits on the same accuracy:
 * daylight is computed to about 30 s at each end, so a session measured at 45
 * min is 45 min plus or minus a minute. A judgement, not a measurement.
 */
export const MIN_SESSION_MINUTES = 45;

/**
 * How many days a current swell reading is allowed to stand in for.
 *
 * This stack has no swell forecast -- only a live buoy reading. Using it as a
 * proxy is defensible for a few days and indefensible beyond that, so past this
 * horizon the swell is unknown and the day can never read `go`.
 *
 * Day 0 is today, so a 5-day horizon covers days 0 through 4. On a 7-day grid
 * the last two columns are always `swell-tbd`, which is the honest answer and is
 * meant to be visible rather than smoothed over. It bites harder here than it
 * does on tidepool: swell is one of four inputs to a tidepool verdict and it is
 * half of a surf one.
 */
export const SWELL_HORIZON_DAYS = 5;

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
 * One maximal stretch of the local day with the tide inside the band.
 *
 * "Maximal" is doing work: two sessions are never adjacent, because a run that
 * touched another would be one run. What separates them is the tide leaving the
 * band, which is a real event with a time, not a gap in the sampling.
 */
export interface SurfSession {
  /** When the tide entered the band, or local midnight when it was already in. */
  startMs: number;
  /** When it left, or the end of the local day when it had not yet. */
  endMs: number;

  /** True when this run began before the local day started. */
  continuesBefore: boolean;
  /** True when it had not ended when the local day did. */
  continuesAfter: boolean;
  /**
   * True when the run ran off the end of the prediction series, so its reported
   * length is a floor on the real one rather than the real one.
   */
  seriesClipped: boolean;

  /**
   * The turning points inside this session, in time order. Zero, one or two.
   *
   * Zero is a pass-through: the tide crossed the whole band on one ebb or one
   * flood without turning. One is the band bracketing a low or a high. Two is
   * the band holding a high and the low after it, which happens when the day's
   * range is small enough that consecutive turns both sit inside.
   *
   * This is reported rather than used, and it is reported because it is the
   * thing #130 needs: an anchor-first solver has to name one extremum per
   * window, and this field is the count of days on which that is impossible.
   */
  anchors: TideExtremum[];

  /** The session after clipping to daylight and then to the operator gate. */
  usableStartMs: number;
  usableEndMs: number;
  usableMinutes: number;

  /**
   * Usable minutes still ahead of `nowMs`, for today only; null on other days.
   *
   * When `now` is before the session starts this is the whole session, not the
   * time until it ends. When `now` is inside it, it is what is left. When the
   * session has closed it is 0.
   */
  minutesRemaining: number | null;

  /** True when there was daylight to use and the gate is what took it. */
  gateBlocked: boolean;
}

export interface SurfDay {
  state: SurfState;
  date: LocalDate;
  /** True when `date` is the local day `nowMs` falls on. */
  isToday: boolean;
  /** Whole local days from today to `date`. Negative for the past. */
  daysFromToday: number;

  /**
   * Every session of the local day, in time order. Empty is exactly the
   * `out-of-band` case.
   */
  sessions: SurfSession[];

  /**
   * The session this day's verdict is about, or null when there are none.
   *
   * The longest by decisive minutes -- remaining time on today, usable time on
   * any other day -- breaking ties on the earlier session. NOT "the next one",
   * which is what tidepool reports: tidepool has one window a day and the
   * question is how much of it is left, while a surf day routinely offers a
   * dawn session and an evening one and the useful answer is the better of them.
   */
  best: SurfSession | null;

  /** Every turning point of the local day, in time order. Normally four. */
  extrema: TideExtremum[];
  /** The day's lowest and highest predicted heights, for the cell face. */
  dayLowFt: number;
  dayHighFt: number;

  sunriseMs: number;
  sunsetMs: number;

  /** Swell as it was applied. `swellKnown` false means unknown, never calm. */
  swellFt: number | null;
  swellKnown: boolean;
  swellCeilingFt: number;
  swellMinimumFt: number;
  band: SurfBand;

  /** One sentence on why this state, for disclosure in the UI. */
  reason: string;
}

/* ===========================================================================
 * Evaluation
 * ========================================================================= */

const MINUTE = 60_000;
const minutesBetween = (fromMs: number, toMs: number) => Math.max(0, (toMs - fromMs) / MINUTE);

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
  if (!Number.isFinite(swellCeilingFt) || !Number.isFinite(swellMinimumFt)) {
    throw new Error('evaluateSurfDay: swellCeilingFt and swellMinimumFt must be finite numbers.');
  }
  if (currentSwellFt !== null && !Number.isFinite(currentSwellFt)) {
    throw new Error(
      'evaluateSurfDay: currentSwellFt must be a finite number or null. Use null ' +
        'for "not delivering"; NaN would compare false against both the ceiling and ' +
        'the minimum and read as a clean pass through the middle.',
    );
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = localDayBounds(date, timeZone);

  const samples = series.samples;
  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  if (!firstSample || !lastSample) {
    throw new Error('evaluateSurfDay: the series has no samples.');
  }
  if (firstSample.tMs > dayStartMs || lastSample.tMs < dayEndMs) {
    throw new Error(
      `evaluateSurfDay: the series does not cover ${date.year}-${date.month}-${date.day} in ` +
        `${timeZone}. Series spans [${new Date(firstSample.tMs).toISOString()}, ` +
        `${new Date(lastSample.tMs).toISOString()}]; the local day needs ` +
        `[${new Date(dayStartMs).toISOString()}, ${new Date(dayEndMs).toISOString()}].`,
    );
  }

  const daylight = daylightBounds(lat, lon, date);
  // Polar cases cannot arise in this corridor, but they are handled rather than
  // allowed to become a NaN session. Never-rises is a whole dark day; never-sets
  // gives the tide the full day to work with.
  const sunriseMs =
    daylight.kind === 'sun-crosses-horizon'
      ? daylight.sunriseMs
      : daylight.kind === 'sun-never-sets'
        ? dayStartMs
        : daylight.solarNoonMs;
  const sunsetMs =
    daylight.kind === 'sun-crosses-horizon'
      ? daylight.sunsetMs
      : daylight.kind === 'sun-never-sets'
        ? dayEndMs
        : daylight.solarNoonMs;

  const today = localDateInZone(nowMs, timeZone);
  const isToday = sameLocalDate(today, date);
  const daysFromToday = localDaysBetween(today, date);

  // A current reading may only stand in for days inside the horizon. Past it the
  // swell is unknown, which is a different thing from calm and a different thing
  // from flat.
  const swellKnown =
    currentSwellFt !== null && daysFromToday >= 0 && daysFromToday < SWELL_HORIZON_DAYS;

  /* -----------------------------------------------------------------------
   * The band walk.
   *
   * One pass over the series collecting maximal runs of `minFt < ft < maxFt`,
   * then keeping the ones that overlap the local day.
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
   * interpolates to it exactly.
   *
   * Walking the whole series and intersecting afterwards, rather than walking
   * only the day's samples, is what lets a session that began before midnight
   * report `continuesBefore` instead of pretending it started at 00:00.
   * --------------------------------------------------------------------- */

  const inBand = (ft: number) => band.minFt < ft && ft < band.maxFt;

  /** Instant at which the segment a->b passes `levelFt`, by linear interpolation. */
  const crossingBetween = (
    a: { tMs: number; ft: number },
    b: { tMs: number; ft: number },
    levelFt: number,
  ) => {
    const da = a.ft - levelFt;
    const db = b.ft - levelFt;
    if (da === db) return a.tMs;
    return Math.round(a.tMs + (da / (da - db)) * (b.tMs - a.tMs));
  };

  /**
   * Which edge the tide crossed to get between an out-of-band sample and an
   * in-band one.
   *
   * Read off the OUT sample rather than inferred from the direction of travel.
   * At or below the minimum it crossed the minimum; at or above the maximum it
   * crossed the maximum. The two are exhaustive because "out of band" has only
   * those two ways of being true, and using the out sample means the exactly-on
   * case picks its own edge instead of falling through a direction test.
   */
  const edgeCrossedFrom = (outFt: number) => (outFt <= band.minFt ? band.minFt : band.maxFt);

  const runs: { openMs: number; closeMs: number; clipped: boolean }[] = [];
  let runStart = -1;

  for (let i = 0; i < samples.length; i++) {
    const here = inBand(samples[i]!.ft);
    if (here && runStart === -1) runStart = i;
    if (!here && runStart !== -1) {
      runs.push({
        openMs:
          runStart === 0
            ? samples[0]!.tMs
            : crossingBetween(
                samples[runStart - 1]!,
                samples[runStart]!,
                edgeCrossedFrom(samples[runStart - 1]!.ft),
              ),
        closeMs: crossingBetween(samples[i - 1]!, samples[i]!, edgeCrossedFrom(samples[i]!.ft)),
        clipped: runStart === 0,
      });
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    // Still in band when the series ran out. The close is the last sample rather
    // than an extrapolated crossing, and the run is marked clipped so its length
    // reads as a minimum.
    runs.push({
      openMs:
        runStart === 0
          ? samples[0]!.tMs
          : crossingBetween(
              samples[runStart - 1]!,
              samples[runStart]!,
              edgeCrossedFrom(samples[runStart - 1]!.ft),
            ),
      closeMs: samples[samples.length - 1]!.tMs,
      clipped: true,
    });
  }

  const extremaAll = findExtrema(series);
  const extrema = extremaAll.filter((e) => e.tMs >= dayStartMs && e.tMs < dayEndMs);

  const sessions: SurfSession[] = [];

  for (const run of runs) {
    // Keep only what overlaps the local day. Half-open on the end, matching every
    // other local-day filter in this repo.
    const startMs = Math.max(run.openMs, dayStartMs);
    const endMs = Math.min(run.closeMs, dayEndMs);
    if (endMs <= startMs) continue;

    /*
     * Two clips, applied in sequence and measured separately, so a cell can say
     * WHICH one shut it. Daylight first: if the session and the daylight do not
     * overlap at all, the gate is irrelevant and the honest answer is `dark`.
     * Only if daylight leaves something does the gate get to take it away.
     */
    const daylightStartMs = Math.max(startMs, sunriseMs);
    const daylightEndMs = Math.min(endMs, sunsetMs);
    const daylightMinutes = minutesBetween(daylightStartMs, daylightEndMs);

    const usableStartMs = gate ? Math.max(daylightStartMs, gate.openMs) : daylightStartMs;
    const usableEndMs = gate ? Math.min(daylightEndMs, gate.closeMs) : daylightEndMs;
    const usableMinutes = minutesBetween(usableStartMs, usableEndMs);

    // The gate is the binding constraint: there was daylight to use and the gate
    // took it. A holiday closure counts however the light falls -- the park does
    // not open at all, which is not a fact about daylight.
    const gateBlocked =
      gate !== null &&
      gate !== undefined &&
      usableMinutes <= 0 &&
      (daylightMinutes > 0 || gate.closedAllDay);

    const remainingStartMs = Math.max(usableStartMs, nowMs);
    const minutesRemaining = isToday ? minutesBetween(remainingStartMs, usableEndMs) : null;

    sessions.push({
      startMs,
      endMs,
      continuesBefore: run.openMs < dayStartMs,
      continuesAfter: run.closeMs > dayEndMs,
      seriesClipped: run.clipped,
      anchors: extremaAll.filter((e) => e.tMs >= startMs && e.tMs <= endMs),
      usableStartMs,
      usableEndMs,
      usableMinutes,
      minutesRemaining,
      gateBlocked,
    });
  }

  const decisiveOf = (s: SurfSession) => (isToday ? (s.minutesRemaining ?? 0) : s.usableMinutes);

  /*
   * The day's best session, by decisive minutes, ties going to the earlier one.
   *
   * `sessions` is already in time order because `runs` is, so a plain reduce
   * keeping strict improvements gives the earlier of two equals without a
   * secondary sort key.
   */
  let best: SurfSession | null = null;
  for (const session of sessions) {
    if (best === null || decisiveOf(session) > decisiveOf(best)) best = session;
  }

  const dayHeights = samples.filter((s) => s.tMs >= dayStartMs && s.tMs < dayEndMs).map((s) => s.ft);
  const dayLowFt = dayHeights.length > 0 ? Math.min(...dayHeights) : NaN;
  const dayHighFt = dayHeights.length > 0 ? Math.max(...dayHeights) : NaN;

  /* -----------------------------------------------------------------------
   * State, in precedence order.
   * --------------------------------------------------------------------- */
  const bestMinutes = best ? decisiveOf(best) : 0;
  const anyGateBlocked = sessions.some((s) => s.gateBlocked);
  const bandText = `${formatThreshold(band.minFt)}–${formatThreshold(band.maxFt)} ft`;

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
  } else if (bestMinutes <= 0 && anyGateBlocked) {
    /*
     * The tide works and there was daylight to use it in; the gate is what took
     * it. Reported separately from `dark` so the cell says which one shut it --
     * "come back when it is light" and "the park is shut" are different advice.
     */
    state = 'closed';
    reason = gate!.closedAllDay
      ? `The tide is in the band, but ${gate!.operator} is closed all day for ` +
        `${gate!.closureName}.`
      : `The tide is in the band, but every session falls outside gate hours — ` +
        `${gate!.operator} is open ${formatClock(gate!.openMs, timeZone)} to ` +
        `${formatClock(gate!.closeMs, timeZone)}.`;
  } else if (bestMinutes <= 0) {
    state = 'dark';
    reason = isToday
      ? 'The tide is in the band, but there is no daylight left today while it is.'
      : `The tide is in the band, but every session falls outside daylight.`;
  } else if (swellKnown && currentSwellFt! > swellCeilingFt) {
    state = 'veto';
    reason =
      `Swell is ${currentSwellFt!.toFixed(1)} ft against an uncalibrated ceiling of ` +
      `${swellCeilingFt.toFixed(1)} ft. Called off regardless of the tide.`;
  } else if (swellKnown && currentSwellFt! < swellMinimumFt) {
    state = 'flat';
    /*
     * Deliberately not worded as a refusal. `veto` is "do not go"; this is
     * "there is nothing there", and a reader who reads the two the same way will
     * treat a flat day as a dangerous one.
     */
    reason =
      `Swell is ${currentSwellFt!.toFixed(1)} ft, under an uncalibrated minimum of ` +
      `${swellMinimumFt.toFixed(1)} ft. The tide works and there is nothing to ride.`;
  } else if (bestMinutes < MIN_SESSION_MINUTES) {
    state = 'brief';
    reason =
      `The longest session is ${Math.round(bestMinutes)} min, under the ` +
      `${MIN_SESSION_MINUTES} min minimum` +
      (sessions.length > 1 ? ` — ${sessions.length} sessions, none of them longer.` : '.');
  } else if (!swellKnown) {
    state = 'swell-tbd';
    reason =
      currentSwellFt === null
        ? 'The tide works, but the buoy is not delivering a swell reading, so the ' +
          'swell is unknown rather than flat.'
        : `The tide works, but this is ${daysFromToday} days out and the swell reading ` +
          `only stands in for ${SWELL_HORIZON_DAYS}. There is no swell forecast in this stack.`;
  } else {
    state = 'go';
    reason =
      `${Math.round(bestMinutes)} min of daylight session with the tide in the ` +
      `${bandText} band and swell at ${currentSwellFt!.toFixed(1)} ft` +
      (sessions.length > 1 ? `, the best of ${sessions.length} today.` : '.');
  }

  if (best?.seriesClipped && state !== 'out-of-band') {
    reason +=
      ' The session runs past the end of the prediction series, so this length is a minimum.';
  }

  return {
    state,
    date,
    isToday,
    daysFromToday,
    sessions,
    best,
    extrema,
    dayLowFt,
    dayHighFt,
    sunriseMs,
    sunsetMs,
    swellFt: swellKnown ? currentSwellFt : null,
    swellKnown,
    swellCeilingFt,
    swellMinimumFt,
    band,
    reason,
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
  return results.reduce((total, day) => total + day.sessions.length, 0);
}
