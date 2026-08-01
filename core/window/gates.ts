/**
 * The gates: daylight, the operator gate, the swell window, the minimum useful
 * duration, and the unknown required input.
 *
 * A gate takes a window the activity's own predicate produced and decides
 * whether it survives. Gates own their states (PRD #101 decision 4), and the
 * precedence between those states is in states.ts.
 *
 * All four behaviours here came across the #129 copy UNCHANGED, and that is the
 * evidence this module was extracted on rather than a guess at what two
 * activities might share. What differs between the two occupants is the height
 * predicate and the sentences, not the gating.
 *
 * ===========================================================================
 * The swell gate is a window, not a ceiling
 * ===========================================================================
 *
 * PRD #101 and #130 both specify "a ceiling emits `veto`". #129 found that a
 * ceiling ALONE calls a flat day `go`: a 0.4 ft buoy reading inside the horizon,
 * with the tide in the band and daylight left, cleared every gate. So the gate
 * is two-sided, and its two answers are deliberately worded as different KINDS
 * of answer — `veto` is "do not go", `flat` is "there is nothing there", and a
 * reader who reads them the same way treats a flat day as a dangerous one.
 *
 * The minimum is optional. An activity that reads swell as a hazard only —
 * tidepool — passes null and gets a one-sided gate, which is exactly the
 * behaviour it had before this module existed.
 *
 * ===========================================================================
 * Two clips, applied in sequence and measured separately
 * ===========================================================================
 *
 * Daylight first: if the window and the daylight do not overlap at all, the
 * operator gate is irrelevant and the honest answer is `dark`. Only if daylight
 * leaves something does the gate get to take it away, and that is the case
 * `closed` reports. "Come back when it is light" and "the park is shut" are
 * different advice, and `gateBlocked` is what keeps them apart.
 */

import type { GateWindow } from '../spot/access';
import { daylightBounds } from '../spot/daylight';
import type { TideSeries } from '../feeds/coops-predictions';
import { formatClock, type LocalDate } from '../time';
import type { CoreState } from './states';

/* ===========================================================================
 * Constants
 * ========================================================================= */

/**
 * Below this, a window is not worth the drive.
 *
 * Covers getting there, being there, and getting back. Both occupants use this
 * number and neither derived it: tidepool set it for a reef exit and surf
 * carried it over as a starting point rather than re-judging it for a paddle
 * out. The duration GATE is shared; the number is an author estimate, and an
 * activity that ever calibrates its own passes its own.
 *
 * Note the accuracy it sits on: daylight is computed to about 30 s at each end,
 * so a window measured at 45 min is really 45 min plus or minus a minute. A
 * judgement, not a measurement, and not to be read as exact to the second.
 */
export const MIN_USABLE_MINUTES = 45;

/**
 * How many days a current swell reading is allowed to stand in for.
 *
 * This stack has no swell forecast — only a live buoy reading. Using it as a
 * proxy is defensible for a few days and indefensible beyond that, so past this
 * horizon the swell is reported as unknown and the day can never read `go`.
 *
 * Day 0 is today, so a 5-day horizon covers days 0 through 4. On a 7-day grid
 * the last two columns are always `swell-tbd`, which is the honest answer and is
 * meant to be visible rather than smoothed over. It bites harder on surf than on
 * tidepool: swell is one of four inputs to a tidepool verdict and half of a surf
 * one.
 *
 * Forward validity is a property of the INPUT rather than of the activity, which
 * is ADR 0009 and https://github.com/cweber12/socal-coastal-data/issues/131.
 * This constant lives here because the gate that reads it does; #131 moves it
 * onto the product it describes and gives water quality — whose forward validity
 * is zero, not merely short — the same treatment.
 */
export const SWELL_HORIZON_DAYS = 5;

const MINUTE = 60_000;

export const minutesBetween = (fromMs: number, toMs: number) =>
  Math.max(0, (toMs - fromMs) / MINUTE);

/* ===========================================================================
 * Preconditions an activity would otherwise each write for itself
 * ========================================================================= */

/**
 * Refuse a series that does not cover the whole local day.
 *
 * Throwing beats clamping. A series that stops at 18:00 would silently report
 * every evening window as closing then, and the number would look ordinary.
 */
export function assertSeriesCoversDay(
  who: string,
  series: TideSeries,
  date: LocalDate,
  timeZone: string,
  dayStartMs: number,
  dayEndMs: number,
): void {
  const firstSample = series.samples[0];
  const lastSample = series.samples[series.samples.length - 1];
  if (!firstSample || !lastSample) {
    throw new Error(`${who}: the series has no samples.`);
  }
  if (firstSample.tMs > dayStartMs || lastSample.tMs < dayEndMs) {
    throw new Error(
      `${who}: the series does not cover ${date.year}-${date.month}-${date.day} in ` +
        `${timeZone}. Series spans [${new Date(firstSample.tMs).toISOString()}, ` +
        `${new Date(lastSample.tMs).toISOString()}]; the local day needs ` +
        `[${new Date(dayStartMs).toISOString()}, ${new Date(dayEndMs).toISOString()}].`,
    );
  }
}

/**
 * Sunrise and sunset as two instants, with the polar cases resolved.
 *
 * They cannot arise in this corridor, but they are handled rather than allowed
 * to become a NaN window. Never-rises is a whole dark day, collapsed to the
 * solar noon instant so every window measures zero against it; never-sets gives
 * the tide the full day to work with.
 */
export function daylightGate(
  lat: number,
  lon: number,
  date: LocalDate,
  dayStartMs: number,
  dayEndMs: number,
): { sunriseMs: number; sunsetMs: number } {
  const daylight = daylightBounds(lat, lon, date);
  return {
    sunriseMs:
      daylight.kind === 'sun-crosses-horizon'
        ? daylight.sunriseMs
        : daylight.kind === 'sun-never-sets'
          ? dayStartMs
          : daylight.solarNoonMs,
    sunsetMs:
      daylight.kind === 'sun-crosses-horizon'
        ? daylight.sunsetMs
        : daylight.kind === 'sun-never-sets'
          ? dayEndMs
          : daylight.solarNoonMs,
  };
}

/* ===========================================================================
 * The daylight and operator-gate clips
 * ========================================================================= */

export interface GateContext {
  sunriseMs: number;
  sunsetMs: number;
  /**
   * Operator gate for this spot on this day, or null where the spot has no
   * operator. Null for 25 of the 26 spots, and null leaves the clip exactly as
   * it was before gates existed.
   */
  gate: GateWindow | null;
  /** Evaluation instant. Passed in, never read from the host clock. */
  nowMs: number;
  isToday: boolean;
}

export interface GateClip {
  usableStartMs: number;
  usableEndMs: number;
  usableMinutes: number;

  /**
   * Usable minutes still ahead of `nowMs`, for today only; null on other days.
   *
   * When `now` is before the window starts this is the whole window, not the
   * time until it ends — the naive reading would overstate what is actually
   * workable. When `now` is inside it, it is what is left. When it has closed it
   * is 0.
   */
  minutesRemaining: number | null;

  /** True when there was daylight to use and the operator gate is what took it. */
  gateBlocked: boolean;
}

/** Clip one window to daylight, then to the operator gate. */
export function clipToGates(startMs: number, endMs: number, ctx: GateContext): GateClip {
  const { sunriseMs, sunsetMs, gate, nowMs, isToday } = ctx;

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

  return {
    usableStartMs,
    usableEndMs,
    usableMinutes,
    minutesRemaining: isToday ? minutesBetween(remainingStartMs, usableEndMs) : null,
    gateBlocked,
  };
}

/* ===========================================================================
 * The swell window
 * ========================================================================= */

export interface SwellWindow {
  /** Significant wave height above which the day is called off. */
  ceilingFt: number;
  /**
   * Significant wave height below which there is nothing there, or null when the
   * activity reads swell as a hazard only. Null is a one-sided gate that can
   * never emit `flat`.
   */
  minimumFt: number | null;
}

/**
 * What the buoy is saying, as the gate reads it.
 *
 * `known: false` means UNKNOWN, which is a different thing from calm and a
 * different thing from flat. Conflating the two is the exact failure this repo
 * is built around, so the reading carries why it is unknown rather than a bare
 * null.
 */
export type SwellReading =
  | { known: false; ft: null; why: 'no-reading' | 'past-horizon'; daysFromToday: number }
  | { known: true; ft: number; side: 'over' | 'under' | 'inside' };

/** Read a buoy value against the window, or refuse it. */
export function readSwell(
  currentFt: number | null,
  daysFromToday: number,
  window: SwellWindow,
): SwellReading {
  if (!Number.isFinite(window.ceilingFt)) {
    throw new Error('readSwell: the swell ceiling must be a finite number.');
  }
  if (window.minimumFt !== null && !Number.isFinite(window.minimumFt)) {
    throw new Error(
      'readSwell: the swell minimum must be a finite number or null. Null is "this activity ' +
        'reads swell as a hazard only"; NaN is not.',
    );
  }
  if (window.minimumFt !== null && !(window.minimumFt < window.ceilingFt)) {
    throw new Error(
      `readSwell: the swell window [${window.minimumFt}, ${window.ceilingFt}] is empty or ` +
        'inverted, so `veto` and `flat` would stop being mutually exclusive.',
    );
  }
  if (currentFt !== null && !Number.isFinite(currentFt)) {
    throw new Error(
      'readSwell: the swell reading must be a finite number or null. Use null for "not ' +
        'delivering"; NaN compares false against every limit it is tested against, so it would ' +
        'fall straight through this gate and read as a clean pass.',
    );
  }

  if (currentFt === null) return { known: false, ft: null, why: 'no-reading', daysFromToday };

  // A current reading may only stand in for days inside the horizon.
  if (!(daysFromToday >= 0 && daysFromToday < SWELL_HORIZON_DAYS)) {
    return { known: false, ft: null, why: 'past-horizon', daysFromToday };
  }

  return {
    known: true,
    ft: currentFt,
    side:
      currentFt > window.ceilingFt
        ? 'over'
        : window.minimumFt !== null && currentFt < window.minimumFt
          ? 'under'
          : 'inside',
  };
}

/* ===========================================================================
 * The verdict
 * ========================================================================= */

export interface GateReading {
  /**
   * The minutes the verdict is decided against: remaining time on today, usable
   * time on any other day.
   *
   * For today this is what `brief` and `dark` are decided against — a window
   * that opened two hours ago and has ten minutes left is brief now, whatever it
   * was at dawn.
   */
  decisiveMinutes: number;
  /** True when a window had daylight in it and the operator gate took it. */
  gateBlocked: boolean;
  swell: SwellReading;
  /** Usually MIN_USABLE_MINUTES. Passed rather than read, so an activity can differ. */
  minimumMinutes: number;
}

/**
 * Which gate state a day lands in, in precedence order.
 *
 * The activity's own predicate state — `above-floor`, `out-of-band` — is tested
 * BEFORE this is called, and both occupants do so for the same reason: there was
 * no window for a gate to shut, so nothing here has anything to say.
 *
 * Returns the state only. The SENTENCE stays with the activity, because the
 * wording is where the two occupants genuinely differ and this repo cares about
 * it — "the window falls outside daylight" and "every session falls outside
 * daylight" are different claims about different shapes. The fragments the two
 * do share are the builders below.
 */
export function gateVerdict(reading: GateReading): CoreState {
  const { decisiveMinutes, gateBlocked, swell, minimumMinutes } = reading;

  if (decisiveMinutes <= 0 && gateBlocked) return 'closed';
  if (decisiveMinutes <= 0) return 'dark';
  if (swell.known && swell.side === 'over') return 'veto';
  if (swell.known && swell.side === 'under') return 'flat';
  if (decisiveMinutes < minimumMinutes) return 'brief';
  if (!swell.known) return 'swell-tbd';
  return 'go';
}

/* ===========================================================================
 * The sentences the two occupants share, word for word
 * ========================================================================= */

/**
 * Why the operator gate shut it.
 *
 * `tideWorks` is the clause naming what the tide did — "The tide drops below the
 * floor", "The tide is in the band" — and `subject` names what fell outside the
 * hours: "the window falls", "every session falls". Both are the activity's,
 * because both describe its own shape.
 */
export function gateClosedReason(
  gate: GateWindow,
  timeZone: string,
  tideWorks: string,
  subject: string,
): string {
  return gate.closedAllDay
    ? `${tideWorks}, but ${gate.operator} is closed all day for ${gate.closureName}.`
    : `${tideWorks}, but ${subject} outside gate hours — ${gate.operator} is open ` +
        `${formatClock(gate.openMs, timeZone)} to ${formatClock(gate.closeMs, timeZone)}.`;
}

/**
 * Why the daylight shut it.
 *
 * Today gets its own clause because the fact is different: on today the window
 * may have been perfectly good this morning and the news is that it has gone,
 * so the sentence is about what is LEFT rather than about where the window fell.
 */
export function darkReason(
  isToday: boolean,
  tideWorksToday: string,
  tideWorks: string,
  subject: string,
): string {
  return isToday
    ? `${tideWorksToday}, but there is no daylight left today while it is.`
    : `${tideWorks}, but ${subject} outside daylight.`;
}

/** Over the ceiling. Identical in both occupants, and says the ceiling is a guess. */
export function swellVetoReason(ft: number, ceilingFt: number): string {
  return (
    `Swell is ${ft.toFixed(1)} ft against an uncalibrated ceiling of ${ceilingFt.toFixed(1)} ft. ` +
    'Called off regardless of the tide.'
  );
}

/**
 * Under the minimum.
 *
 * Deliberately not worded as a refusal. `veto` is "do not go"; this is "there is
 * nothing there". `activities/surf/policy.test.ts` asserts this sentence carries
 * neither "called off" nor "veto".
 */
export function swellFlatReason(ft: number, minimumFt: number, tideWorks: string): string {
  return (
    `Swell is ${ft.toFixed(1)} ft, under an uncalibrated minimum of ${minimumFt.toFixed(1)} ft. ` +
    `${tideWorks} and there is nothing to ride.`
  );
}

/**
 * Why the swell is unknown.
 *
 * `alternative` is the thing a reader might otherwise assume — "calm" for an
 * activity reading swell as a hazard, "flat" for one reading it in both
 * directions. The sentence names it so the null cannot be read as either.
 */
export function swellUnknownReason(swell: SwellReading, alternative: string): string {
  if (swell.known) {
    throw new Error('swellUnknownReason: called for a known reading.');
  }
  return swell.why === 'no-reading'
    ? 'The tide works, but the buoy is not delivering a swell reading, so the swell is ' +
        `unknown rather than ${alternative}.`
    : `The tide works, but this is ${swell.daysFromToday} days out and the swell reading only ` +
        `stands in for ${SWELL_HORIZON_DAYS}. There is no swell forecast in this stack.`;
}
