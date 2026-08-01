/**
 * Tidepool's judgement: a floor, a flood-side trim, and which low the day is
 * about. Pure: no network, no ambient clock -- `now` is passed in, so every
 * state is reproducible from its inputs.
 *
 * The question: given a day's tide predictions, how much workable reef time is
 * there, and if there is none, why not.
 *
 * ===========================================================================
 * What this owns, now that the engine is next door
 * ===========================================================================
 *
 * #130 pulled the solver, the gates and the gate states into `core/window/` out
 * of this file and `activities/surf/policy.ts` together. What is left here is
 * everything that is a JUDGEMENT about tidepooling, and it is worth naming
 * because the split is the whole point of the exercise:
 *
 *   the floor          a height predicate, one-sided: `ft < floorFt`
 *   FLOOD_SIDE_TRIM    a safety asymmetry about getting off a reef
 *   the selection      which low the day reports on
 *   `above-floor`      the state this predicate emits
 *   the sentences      what a reader is told, in this activity's words
 *
 * The solver returns N intervals and does not know what a low is. Tidepool's
 * anchor did not disappear in the extraction -- it moved UP, into the selection
 * below, because "which low is this day about" is this activity's question and
 * surf answers a different one. See core/window/solve.ts.
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
  swellUnknownReason,
  swellVetoReason,
  SWELL_HORIZON_DAYS,
} from '../../core/window/gates';
import { intervalAt, solve } from '../../core/window/solve';
import {
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  sameLocalDate,
  type LocalDate,
} from '../../core/time';
import { STATE_PRESENTATION, type CellLighting, type WindowState } from './states';

export { SWELL_HORIZON_DAYS };

/* ===========================================================================
 * Constants
 * ========================================================================= */

/**
 * Below this, a window is not worth the drive.
 *
 * The shared duration gate's default, named here because this activity's pages
 * quote it. See core/window/gates.ts for why the number is a judgement rather
 * than a measurement, and for the accuracy it sits on.
 */
export const MIN_WINDOW_MINUTES = MIN_USABLE_MINUTES;

/**
 * Fraction of the flood side kept.
 *
 * The window is deliberately asymmetric about the low. The ebb side -- the tide
 * still falling towards the low -- is fully usable: the water is leaving, more
 * reef keeps appearing, and the way back stays open. The flood side is not
 * equivalent at the same height. The water is returning, surge starts refilling
 * channels, footing that was dry gets slick, and on a ledge system anyone who
 * waits for the same height on the way out can find the return cut off.
 *
 * So the flood side is trimmed to 0.6 of the time it would take to come back up
 * to the floor. This is a safety margin, not a measurement, and it is
 * deliberately the one constant here that errs toward less time rather than
 * more.
 *
 * It STAYS HERE, and #130 said so before the extraction started. It is a fact
 * about being on foot on a ledge system while the water returns, not a property
 * of any solver, and it has no equivalent for someone already in the water --
 * copying it into core/ would have been the clearest possible case of
 * generalising one occupant's safety judgement into an engine.
 */
export const FLOOD_SIDE_TRIM = 0.6;

export interface WindowInput {
  /** Prediction series covering at least the whole local day being evaluated. */
  series: TideSeries;
  /** The local calendar day to evaluate. */
  date: LocalDate;
  /** Tide height below which the reef is workable, in the series units. */
  floorFt: number;
  /** Significant wave height above which the day is called off. */
  swellCeilingFt: number;
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
   * operator. Null for 25 of the 26 spots, and null leaves the predicate exactly
   * as it was before gates existed.
   */
  gate?: GateWindow | null;
}

/**
 * Everything about a tidepool day that only tidepool can answer.
 *
 * These four -- `lowFt`, `nextHighMs`, `reachesFloor`, `floorFt` -- used to sit
 * on the shared result type, where they asserted that every activity is anchored
 * on a low and judged against a floor. Surf is neither. See core/window/day.ts.
 */
export interface TidepoolDetail {
  /**
   * The window this day's verdict is about, or null.
   *
   * Null is exactly the `above-floor` case: the low this day reports on never
   * gets under the floor, so there is no window rather than a zero-length one.
   *
   * Note this can be null while `windows` is NOT empty. Today's rule reports on
   * the next low from now even when an earlier low had a window and that window
   * has since shut -- what the reader has ahead of them is the honest answer,
   * and `above-floor` is a perfectly good one.
   */
  window: UsableWindow | null;

  /** The low this evaluation is about. */
  lowMs: number;
  lowFt: number;
  /** First high after the low. null when the series ends before it. */
  nextHighMs: number | null;
  nextHighFt: number | null;

  /** Whether the tide actually gets under the floor around this low. */
  reachesFloor: boolean;

  floorFt: number;
}

/**
 * Narrowed on `swellMinimumFt`: tidepool reads swell as a hazard only, so it is
 * always null here and the type says so rather than leaving it open.
 */
export type WindowResult = ActivityDay<WindowState, TidepoolDetail> & {
  swellMinimumFt: null;
};

/* ===========================================================================
 * Evaluation
 * ========================================================================= */

/** The one caveat a tidepool day can carry today. */
const SERIES_CLIPPED_NOTE =
  'The window runs past the end of the prediction series, so this length is a minimum.';

/**
 * Evaluate one spot on one local day.
 *
 * Throws when the floor is not a finite number. A null floor means unresolved
 * in the intertidal zone file, and this refuses to invent one: it would produce
 * a confident-looking state for a spot whose reef depth nobody has established.
 * Callers filter to spots that carry a floor.
 */
export function evaluateWindow(input: WindowInput): WindowResult {
  const {
    series,
    date,
    floorFt,
    swellCeilingFt,
    currentSwellFt,
    nowMs,
    lat,
    lon,
    timeZone,
    gate = null,
  } = input;

  if (!Number.isFinite(floorFt)) {
    throw new Error(
      'evaluateWindow: floorFt must be a finite number. A null or missing floor ' +
        'is unresolved, and guessing one produces a confident state for a reef ' +
        'whose workable depth has never been established.',
    );
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = localDayBounds(date, timeZone);

  const today = localDateInZone(nowMs, timeZone);
  const isToday = sameLocalDate(today, date);
  const daysFromToday = localDaysBetween(today, date);

  // Tidepool reads swell as a HAZARD ONLY, so it passes no minimum and the gate
  // is one-sided. It can never emit `flat`, and its states list says so.
  const swell = readSwell(currentSwellFt, daysFromToday, {
    ceilingFt: swellCeilingFt,
    minimumFt: null,
  });

  assertSeriesCoversDay('evaluateWindow', series, date, timeZone, dayStartMs, dayEndMs);

  const { sunriseMs, sunsetMs } = daylightGate(lat, lon, date, dayStartMs, dayEndMs);

  const extrema = findExtrema(series);
  const lowsToday = extrema.filter(
    (e) => e.kind === 'low' && e.tMs >= dayStartMs && e.tMs < dayEndMs,
  );

  if (lowsToday.length === 0) {
    throw new Error(
      `evaluateWindow: no low tide found within the local day ` +
        `${date.year}-${date.month}-${date.day}. Every day in this corridor has at ` +
        'least one, so this means the series is too short or too coarse to resolve it.',
    );
  }

  /* -----------------------------------------------------------------------
   * One window per low, from the sub-floor excursion around it.
   *
   * The solver hands back every maximal sub-floor interval of the day; this
   * picks the one a given low sits in and applies the flood-side trim to it.
   *
   * The seed is the deepest sample under the floor within one index of the low's
   * refined vertex, and it is what identifies the interval. Going through a
   * sample rather than through the vertex directly is deliberate: the vertex is
   * fitted between samples, and a low that only TOUCHES the floor has no sample
   * beneath it and so has no excursion -- which is the right answer, because an
   * instant is not a window.
   * --------------------------------------------------------------------- */

  const samples = series.samples;
  const intervals = solve(
    series,
    { holds: (ft) => ft < floorFt, edgeFrom: () => floorFt },
    { startMs: dayStartMs, endMs: dayEndMs },
  );

  const nearestSampleIndex = (tMs: number): number => {
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid]!.tMs <= tMs) lo = mid;
      else hi = mid;
    }
    return tMs - samples[lo]!.tMs <= samples[hi]!.tMs - tMs ? lo : hi;
  };

  const gateContext = { sunriseMs, sunsetMs, gate, nowMs, isToday };

  const windowFor = (low: TideExtremum): UsableWindow | null => {
    const centre = nearestSampleIndex(low.tMs);

    let seed = -1;
    for (let k = Math.max(0, centre - 1); k <= Math.min(samples.length - 1, centre + 1); k++) {
      if (samples[k]!.ft < floorFt && (seed === -1 || samples[k]!.ft < samples[seed]!.ft)) seed = k;
    }
    if (seed === -1) return null;

    const excursion = intervalAt(intervals, samples[seed]!.tMs);
    if (excursion === null) return null;

    // The ebb side runs to the low in full; the flood side is trimmed.
    const startMs = excursion.openMs;
    const endMs = Math.round(low.tMs + FLOOD_SIDE_TRIM * (excursion.closeMs - low.tMs));

    return {
      startMs,
      endMs,
      continuesBefore: startMs < dayStartMs,
      continuesAfter: endMs > dayEndMs,
      seriesClipped: excursion.seriesClipped,
      anchors: excursion.anchors.filter((e) => e.tMs >= startMs && e.tMs <= endMs),
      ...clipToGates(startMs, endMs, gateContext),
    };
  };

  const windowByLow = new Map<TideExtremum, UsableWindow | null>(
    lowsToday.map((candidate) => [candidate, windowFor(candidate)]),
  );
  const windowOf = (candidate: TideExtremum) => windowByLow.get(candidate) ?? null;
  const usableMinutesOf = (candidate: TideExtremum) => windowOf(candidate)?.usableMinutes ?? 0;

  /* -----------------------------------------------------------------------
   * Which low is this day about?
   *
   * THE ANCHOR, and it lives here rather than in the solver because it is this
   * activity's judgement. Surf's answer to the same question is different and
   * neither is more correct.
   *
   * Today: the NEXT one from the current time -- but a low whose window is
   * still open counts as "next", because being partway through a window is the
   * commonest way to look at this page and reporting the following low would
   * hide the time actually left.
   *
   * "Next" is meant literally, including when the next low is a poor one. A
   * cell headed "today" that reports a low which happened at 03:49 this morning
   * is answering a question nobody asked; whether this afternoon's 2.4 ft low
   * uncovers anything is the question, and `above-floor` is a perfectly good
   * answer to it.
   *
   * Any other day: the best daylight low, meaning the one with the most usable
   * daylight window, breaking ties on the lower tide.
   * --------------------------------------------------------------------- */
  const bestByDaylight = [...lowsToday].sort((a, b) => {
    const byUsable = usableMinutesOf(b) - usableMinutesOf(a);
    if (byUsable !== 0) return byUsable;
    // Both unusable: prefer the lower tide, which at least gets nearest the floor
    // and is the one the cell should report on.
    return a.ft - b.ft;
  })[0]!;

  let low: TideExtremum;

  if (isToday) {
    /*
     * The next low whose window has not already shut. Only lows that actually
     * reach the floor are eligible: an above-floor low has no window at all, and
     * before #130 it carried a zero-length one sitting at its own instant, which
     * trivially satisfied "ends after now" and would otherwise be picked up as
     * the next opportunity when it is not one.
     */
    const stillOpen = lowsToday.find((candidate) => {
      const w = windowOf(candidate);
      return w !== null && w.endMs >= nowMs;
    });

    /*
     * No window still open, so fall through to the next low from now whether or
     * not it reaches the floor. The now-clip drives the state, and for a low that
     * never gets under the floor that is `above-floor` -- which is the honest
     * report on the tide someone actually has ahead of them today.
     */
    const nextFromNow = lowsToday.find((candidate) => candidate.tMs >= nowMs);

    /*
     * Past the day's last low. There is no "next" left to report, so the last
     * one stands, and the now-clip puts the cell in `dark`: nothing more is
     * coming today. Picking the day's BEST low here instead would report a
     * window that closed this morning as though it were still the news.
     */
    low = stillOpen ?? nextFromNow ?? lowsToday[lowsToday.length - 1]!;
  } else {
    low = bestByDaylight;
  }

  const window = windowOf(low);
  const nextHigh = extrema.find((e) => e.kind === 'high' && e.tMs > low.tMs) ?? null;

  /* -----------------------------------------------------------------------
   * State, in precedence order. `above-floor` first, then the gates.
   * --------------------------------------------------------------------- */
  const decisiveMinutes =
    window === null ? 0 : isToday ? (window.minutesRemaining ?? 0) : window.usableMinutes;

  // The clause every gate sentence is built on. Tidepool's shape is ONE window
  // around one low, so the subject is singular.
  const TIDE_WORKS = 'The tide drops below the floor';
  const SUBJECT = 'the window falls';

  let state: WindowState;
  let reason: string;

  if (window === null) {
    state = 'above-floor';
    reason =
      `${isToday ? 'The next low' : "The day's best low"} only reaches ` +
      `${low.ft.toFixed(1)} ft, which does not get under the ${formatThreshold(floorFt)} ft floor. ` +
      'The reef stays covered.';
  } else {
    const gated = gateVerdict({
      decisiveMinutes,
      gateBlocked: window.gateBlocked,
      swell,
      minimumMinutes: MIN_WINDOW_MINUTES,
    });

    if (gated === 'flat') {
      /*
       * Unreachable, and asserted rather than defaulted. Tidepool declares no
       * swell minimum, so its gate is one-sided and `flat` has no way out of it.
       * If that ever changes, this is a loud failure rather than a state with no
       * sentence and no presentation row.
       */
      throw new Error(
        'evaluateWindow: the swell gate emitted `flat`, which needs a minimum, and tidepool ' +
          'declares none. Swell is a hazard here, not something to ride.',
      );
    }
    state = gated;

    switch (state) {
      case 'closed':
        reason = gateClosedReason(gate!, timeZone, TIDE_WORKS, SUBJECT);
        break;
      case 'dark':
        reason = darkReason(isToday, 'The tide is low enough', TIDE_WORKS, SUBJECT);
        break;
      case 'veto':
        reason = swellVetoReason(swell.ft!, swellCeilingFt);
        break;
      case 'brief':
        reason =
          `Only ${Math.round(decisiveMinutes)} min of usable window, under the ` +
          `${MIN_WINDOW_MINUTES} min minimum.`;
        break;
      case 'swell-tbd':
        // "calm" rather than "flat": this activity reads swell as a hazard, and
        // the assumption a reader would otherwise make is that it is quiet.
        reason = swellUnknownReason(swell, 'calm');
        break;
      default:
        reason =
          `${Math.round(decisiveMinutes)} min of daylight window with the tide under the ` +
          `floor and swell at ${swell.ft!.toFixed(1)} ft.`;
    }
  }

  const disclosures = window !== null && window.seriesClipped ? [SERIES_CLIPPED_NOTE] : [];

  return {
    state,
    date,
    isToday,
    daysFromToday,
    windows: lowsToday
      .map(windowOf)
      .filter((w): w is UsableWindow => w !== null),
    sunriseMs,
    sunsetMs,
    swellFt: swell.known ? swell.ft : null,
    swellKnown: swell.known,
    swellCeilingFt,
    swellMinimumFt: null,
    reason: [reason, ...disclosures].join(' '),
    disclosures,
    detail: {
      window,
      lowMs: low.tMs,
      lowFt: low.ft,
      nextHighMs: nextHigh?.tMs ?? null,
      nextHighFt: nextHigh?.ft ?? null,
      reachesFloor: window !== null,
      floorFt,
    },
  };
}

export function lowLighting(result: WindowResult): CellLighting {
  const { lowMs } = result.detail;
  return lowMs >= result.sunriseMs && lowMs <= result.sunsetMs ? 'day' : 'night';
}

/** How many of a spot's days are usable. Drives the default sort. */
export function countUsable(results: readonly WindowResult[]): number {
  return results.filter((r) => STATE_PRESENTATION[r.state].usable).length;
}
