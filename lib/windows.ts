/**
 * The window predicate. Pure: no network, no ambient clock -- `now` is passed
 * in, so every state is reproducible from its inputs.
 *
 * The question: given a day's tide predictions, how much workable reef time is
 * there, and if there is none, why not.
 */

import { daylightBounds, findExtrema, type TideExtremum, type TideSeries } from './tide';
import { localDateInZone, localDayBounds, localDaysBetween, sameLocalDate, type LocalDate } from './time';

/* ===========================================================================
 * Constants
 * ========================================================================= */

/**
 * Below this, a window is not worth the drive. Covers getting down the trail,
 * being on the reef, and getting back off it.
 *
 * Note the accuracy this sits on: daylight is computed to about 30 s at each
 * end, so a window measured at 45 min is really 45 min plus or minus a minute.
 * The threshold is a judgement, not a measurement, and should not be read as
 * exact to the second.
 */
export const MIN_WINDOW_MINUTES = 45;

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
 */
export const FLOOD_SIDE_TRIM = 0.6;

/**
 * How many days a current swell reading is allowed to stand in for.
 *
 * This stack has no swell forecast -- only a live buoy reading. Using it as a
 * proxy is defensible for a few days and indefensible beyond that, so past this
 * horizon the swell is reported as unknown and the day can never read `go`.
 *
 * Day 0 is today, so a 5-day horizon covers days 0 through 4. On a 7-day grid
 * the last two columns are always `swell-tbd`, which is the honest answer and is
 * meant to be visible rather than smoothed over.
 */
export const SWELL_HORIZON_DAYS = 5;

/* ===========================================================================
 * Types
 * ========================================================================= */

/**
 * The six states, in the order they are tested. Certain verdicts come before
 * uncertain ones.
 *
 *   above-floor  The low never reaches the floor. The reef does not surface.
 *   dark         The window and the available daylight do not overlap.
 *   veto         A known swell reading is over the ceiling.
 *   brief        There is a window, but under MIN_WINDOW_MINUTES of it.
 *   swell-tbd    Everything else clears, but the swell is unknown.
 *   go           Clears everything.
 *
 * Two orderings are deliberate:
 *
 *   `brief` sits BELOW `veto` because a swell over the ceiling is a settled no,
 *   and there is no point qualifying a no with how long it would have been.
 *
 *   `swell-tbd` sits BELOW `brief` because a 20-minute window is a settled fact
 *   about the tide and should be reported as such rather than deferred to an
 *   unknown. It sits ABOVE `go` so that an unknown can never render as a pass.
 */
export type WindowState = 'above-floor' | 'dark' | 'veto' | 'brief' | 'swell-tbd' | 'go';

export const WINDOW_STATES: readonly WindowState[] = [
  'above-floor',
  'dark',
  'veto',
  'brief',
  'swell-tbd',
  'go',
];

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
}

export interface WindowResult {
  state: WindowState;
  date: LocalDate;
  /** True when `date` is the local day `nowMs` falls on. */
  isToday: boolean;
  /** Whole local days from today to `date`. Negative for the past. */
  daysFromToday: number;

  /** The low this evaluation is about. */
  lowMs: number;
  lowFt: number;
  /** First high after the low. null when the series ends before it. */
  nextHighMs: number | null;
  nextHighFt: number | null;

  /** The window from the sub-floor excursion, before any clipping. */
  windowStartMs: number;
  windowEndMs: number;

  /**
   * Whether the tide actually gets under the floor around this low. False is
   * exactly the `above-floor` case, and means the window fields are a
   * zero-length placeholder at the low rather than a real interval.
   */
  reachesFloor: boolean;

  /**
   * The window after clipping to daylight. For today this is NOT clipped to
   * `now` -- that is `minutesRemaining` -- so the UI can say "1 h 36 min window,
   * 42 min left".
   */
  usableStartMs: number;
  usableEndMs: number;
  usableMinutes: number;

  /**
   * Usable minutes still ahead of `nowMs`, for today only; null on other days.
   *
   * When `now` is before the window starts this is the whole window, not the
   * time until it ends. When `now` is inside the window it is what is left. When
   * the window has closed it is 0.
   *
   * For today, this is what `brief` and `dark` are decided against -- a window
   * that opened two hours ago and has ten minutes left is brief now, whatever it
   * was at dawn.
   */
  minutesRemaining: number | null;

  sunriseMs: number;
  sunsetMs: number;

  /** Swell as it was applied. `swellKnown` false means unknown, never calm. */
  swellFt: number | null;
  swellKnown: boolean;
  swellCeilingFt: number;
  floorFt: number;

  /**
   * True when the window ran past the end of the series and was cut there, so
   * the reported length is a floor on the real one rather than the real one.
   */
  windowClipped: boolean;

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
 * Throws when the floor is not a finite number. A null floor means unresolved
 * in `spots.json`, and this refuses to invent one: it would produce a
 * confident-looking state for a spot whose reef depth nobody has established.
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
  } = input;

  if (!Number.isFinite(floorFt)) {
    throw new Error(
      'evaluateWindow: floorFt must be a finite number. A null or missing floor ' +
        'is unresolved, and guessing one produces a confident state for a reef ' +
        'whose workable depth has never been established.',
    );
  }
  if (!Number.isFinite(swellCeilingFt)) {
    throw new Error('evaluateWindow: swellCeilingFt must be a finite number.');
  }
  if (currentSwellFt !== null && !Number.isFinite(currentSwellFt)) {
    throw new Error(
      'evaluateWindow: currentSwellFt must be a finite number or null. Use null ' +
        'for "not delivering"; NaN would compare false against the ceiling and ' +
        'read as under it.',
    );
  }

  const { startMs: dayStartMs, endMs: dayEndMs } = localDayBounds(date, timeZone);

  const firstSample = series.samples[0];
  const lastSample = series.samples[series.samples.length - 1];
  if (!firstSample || !lastSample) {
    throw new Error('evaluateWindow: the series has no samples.');
  }
  if (firstSample.tMs > dayStartMs || lastSample.tMs < dayEndMs) {
    throw new Error(
      `evaluateWindow: the series does not cover ${date.year}-${date.month}-${date.day} in ` +
        `${timeZone}. Series spans [${new Date(firstSample.tMs).toISOString()}, ` +
        `${new Date(lastSample.tMs).toISOString()}]; the local day needs ` +
        `[${new Date(dayStartMs).toISOString()}, ${new Date(dayEndMs).toISOString()}].`,
    );
  }

  const daylight = daylightBounds(lat, lon, date);
  // Polar cases cannot arise in this corridor, but they are handled rather than
  // allowed to become a NaN window. Never-rises is a whole dark day; never-sets
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
  // swell is unknown, which is a different thing from calm.
  const swellKnown =
    currentSwellFt !== null && daysFromToday >= 0 && daysFromToday < SWELL_HORIZON_DAYS;

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
   * Geometry for one candidate low.
   *
   * The window comes from the SUB-FLOOR EXCURSION around this particular low:
   * walk outward from the low while samples stay under the floor, and
   * interpolate the crossing at each end.
   *
   * The obvious alternative -- ask for every floor crossing in the series, then
   * take the nearest falling one before the low and the nearest rising one after
   * -- is wrong twice over, and both failures look plausible rather than broken:
   *
   *   1. For a low that never reaches the floor, those two crossings belong to a
   *      DIFFERENT low, usually the previous one. The pair spans the intervening
   *      high and yields a phantom window of ten or twelve hours, which then wins
   *      the "best daylight low" ranking below and makes the day report on the
   *      wrong low entirely. Real case: 27 July 2026 at Cabrillo, where the
   *      sub-floor low is at 03:21 in the dark and the afternoon low at 2.581 ft
   *      is far above the floor. The phantom makes that afternoon low score a
   *      twelve-hour daylight window and the day reads `above-floor`, when the
   *      truth is that the one workable low is before sunrise -- `dark`.
   *
   *   2. For a low that touches the floor exactly, the crossing on the way down
   *      is not emitted at all: the sample sits ON the level, so neither
   *      neighbouring pair straddles it. The search then finds no falling
   *      crossing, falls back to the start of the series, and invents a window
   *      running from whenever the series began. Predictions are quoted to three
   *      decimals and floors are quoted to one, so an exact tie is not exotic.
   *
   * Walking the excursion locally cannot reach another low, and needs no special
   * case for a tie: a low that only touches the floor has no sample beneath it
   * and so has no excursion.
   *
   * Returns null when no sample around the low is under the floor. A true dip
   * lasting less than one sample interval is missed, which is a window under six
   * minutes and far below the 45-minute threshold either way.
   * --------------------------------------------------------------------- */

  const samples = series.samples;

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

  /** Instant at which the segment a->b passes `floorFt`, by linear interpolation. */
  const crossingBetween = (a: { tMs: number; ft: number }, b: { tMs: number; ft: number }) => {
    const da = a.ft - floorFt;
    const db = b.ft - floorFt;
    if (da === db) return a.tMs;
    return Math.round(a.tMs + (da / (da - db)) * (b.tMs - a.tMs));
  };

  const excursionFor = (low: TideExtremum) => {
    const centre = nearestSampleIndex(low.tMs);

    // The refined vertex sits between samples, so check its immediate
    // neighbourhood for the deepest sample actually under the floor.
    let seed = -1;
    for (let k = Math.max(0, centre - 1); k <= Math.min(samples.length - 1, centre + 1); k++) {
      if (samples[k]!.ft < floorFt && (seed === -1 || samples[k]!.ft < samples[seed]!.ft)) seed = k;
    }
    if (seed === -1) return null;

    let l = seed;
    while (l > 0 && samples[l - 1]!.ft < floorFt) l--;
    let r = seed;
    while (r < samples.length - 1 && samples[r + 1]!.ft < floorFt) r++;

    return {
      openMs: l === 0 ? samples[0]!.tMs : crossingBetween(samples[l - 1]!, samples[l]!),
      closeMs:
        r === samples.length - 1 ? samples[r]!.tMs : crossingBetween(samples[r]!, samples[r + 1]!),
      // The excursion ran off the end of the series, so its length is a floor on
      // the real one rather than the real one.
      clipped: l === 0 || r === samples.length - 1,
    };
  };

  const geometryFor = (low: TideExtremum) => {
    const excursion = excursionFor(low);

    if (excursion === null) {
      return {
        windowStartMs: low.tMs,
        windowEndMs: low.tMs,
        usableStartMs: low.tMs,
        usableEndMs: low.tMs,
        usableMinutes: 0,
        minutesRemaining: isToday ? 0 : null,
        windowClipped: false,
        reachesFloor: false,
      };
    }

    // The ebb side runs to the low in full; the flood side is trimmed.
    const windowStartMs = excursion.openMs;
    const windowEndMs = Math.round(low.tMs + FLOOD_SIDE_TRIM * (excursion.closeMs - low.tMs));

    const usableStartMs = Math.max(windowStartMs, sunriseMs);
    const usableEndMs = Math.min(windowEndMs, sunsetMs);
    const usableMinutes = minutesBetween(usableStartMs, usableEndMs);

    const remainingStartMs = Math.max(usableStartMs, nowMs);
    const minutesRemaining = isToday ? minutesBetween(remainingStartMs, usableEndMs) : null;

    return {
      windowStartMs,
      windowEndMs,
      usableStartMs,
      usableEndMs,
      usableMinutes,
      minutesRemaining,
      windowClipped: excursion.clipped,
      reachesFloor: true,
    };
  };

  type Geometry = ReturnType<typeof geometryFor>;
  const geometryByLow = new Map<TideExtremum, Geometry>(
    lowsToday.map((candidate) => [candidate, geometryFor(candidate)]),
  );
  const geometryOf = (candidate: TideExtremum): Geometry => geometryByLow.get(candidate)!;

  /* -----------------------------------------------------------------------
   * Which low is this day about?
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
    const byUsable = geometryOf(b).usableMinutes - geometryOf(a).usableMinutes;
    if (byUsable !== 0) return byUsable;
    // Both unusable: prefer the lower tide, which at least gets nearest the floor
    // and is the one the cell should report on.
    return a.ft - b.ft;
  })[0]!;

  let low: TideExtremum;

  if (isToday) {
    /*
     * The next low whose window has not already shut. Only lows that actually
     * reach the floor are eligible: an above-floor low has a zero-length window
     * sitting at its own instant, which trivially satisfies "ends after now" and
     * would otherwise be picked up as the next opportunity when it is not one.
     */
    const stillOpen = lowsToday.find((candidate) => {
      const g = geometryOf(candidate);
      return g.reachesFloor && g.windowEndMs >= nowMs;
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

  const geometry = geometryOf(low);
  const nextHigh = extrema.find((e) => e.kind === 'high' && e.tMs > low.tMs) ?? null;

  /* -----------------------------------------------------------------------
   * State, in precedence order.
   * --------------------------------------------------------------------- */
  const decisiveMinutes = isToday ? (geometry.minutesRemaining ?? 0) : geometry.usableMinutes;

  let state: WindowState;
  let reason: string;

  if (!geometry.reachesFloor) {
    state = 'above-floor';
    reason =
      `${isToday ? 'The next low' : "The day's best low"} only reaches ` +
      `${low.ft.toFixed(1)} ft, which does not get under the ${floorFt.toFixed(1)} ft floor. ` +
      'The reef stays covered.';
  } else if (decisiveMinutes <= 0) {
    state = 'dark';
    reason = isToday
      ? "The tide is low enough, but there is no daylight left today while it is."
      : `The tide drops below the floor, but the window falls outside daylight.`;
  } else if (swellKnown && currentSwellFt! > swellCeilingFt) {
    state = 'veto';
    reason =
      `Swell is ${currentSwellFt!.toFixed(1)} ft against an uncalibrated ceiling of ` +
      `${swellCeilingFt.toFixed(1)} ft. Called off regardless of the tide.`;
  } else if (decisiveMinutes < MIN_WINDOW_MINUTES) {
    state = 'brief';
    reason =
      `Only ${Math.round(decisiveMinutes)} min of usable window, under the ` +
      `${MIN_WINDOW_MINUTES} min minimum.`;
  } else if (!swellKnown) {
    state = 'swell-tbd';
    reason =
      currentSwellFt === null
        ? 'The tide works, but the buoy is not delivering a swell reading, so the ' +
          'swell is unknown rather than calm.'
        : `The tide works, but this is ${daysFromToday} days out and the swell reading ` +
          `only stands in for ${SWELL_HORIZON_DAYS}. There is no swell forecast in this stack.`;
  } else {
    state = 'go';
    reason =
      `${Math.round(decisiveMinutes)} min of daylight window with the tide under the ` +
      `floor and swell at ${currentSwellFt!.toFixed(1)} ft.`;
  }

  if (geometry.windowClipped && state !== 'above-floor') {
    reason += ' The window runs past the end of the prediction series, so this length is a minimum.';
  }

  return {
    state,
    date,
    isToday,
    daysFromToday,
    lowMs: low.tMs,
    lowFt: low.ft,
    nextHighMs: nextHigh?.tMs ?? null,
    nextHighFt: nextHigh?.ft ?? null,
    ...geometry,
    sunriseMs,
    sunsetMs,
    swellFt: swellKnown ? currentSwellFt : null,
    swellKnown,
    swellCeilingFt,
    floorFt,
    reason,
  };
}

/* ===========================================================================
 * Presentation helpers, kept next to the states they describe
 * ========================================================================= */

export interface StatePresentation {
  /** Short label, shown where the state is disclosed rather than on a cell face. */
  label: string;
  /** Word used in the aria-label sentence. */
  spoken: string;
  /**
   * Glyph. It is not a substitute for the word -- both are always shown together
   * -- it is a second channel so the label is recognisable at a glance.
   *
   * None of these may be `▲` or `▼`. Those two are the tide arrows a cell puts
   * against its high and its low, and a state glyph that collides with one reads
   * as a second, contradictory tide reading in the same cell.
   */
  glyph: string;
  /** Whether this state means "you could go". */
  usable: boolean;
}

/**
 * How a state is worded when it is disclosed.
 *
 * No colour here any more. The states used to carry one each, painted across the
 * whole cell, and on an ordinary week that produced 56 coloured verdicts from a
 * predicate resting on two uncalibrated numbers -- a floor nobody has field-checked
 * and a swell ceiling that is a corridor-wide guess. The colour asserted a
 * confidence the maths does not have. Until the thresholds are calibrated the
 * state is secondary information: it lives behind a badge, in words.
 */
export const STATE_PRESENTATION: Readonly<Record<WindowState, StatePresentation>> = {
  go: { label: 'Go', spoken: 'go', glyph: '●', usable: true },
  brief: { label: 'Brief', spoken: 'brief', glyph: '◐', usable: false },
  veto: { label: 'Swell', spoken: 'vetoed on swell', glyph: '✕', usable: false },
  dark: { label: 'No light', spoken: 'outside daylight', glyph: '☾', usable: false },
  'above-floor': {
    // "Covered", not "too high". The cell already prints the height next to a ▼,
    // so a reader can see for themselves that it is high; what the state adds is
    // what that means -- the reef stays under water.
    label: 'Covered',
    spoken: 'above the floor',
    glyph: '≈',
    usable: false,
  },
  'swell-tbd': { label: 'Swell TBD', spoken: 'swell unknown', glyph: '?', usable: false },
};

/**
 * Whether the low this result reports falls in daylight.
 *
 * This is what a cell's background says, and it is deliberately the plainest fact
 * available: is the clock time printed in the cell before sunset and after
 * sunrise. It is NOT the `dark` state. `dark` is a verdict about the whole
 * window -- a low at 5:30 pm can be in daylight while the usable part of its
 * window is not -- and verdicts are exactly what the background stopped carrying.
 *
 * Sunrise and sunset are computed to about 30 s, so a low within a minute of
 * either edge could be shaded the other way. Nothing is decided on this: it is a
 * background, and the time itself is printed next to it.
 */
export type CellLighting = 'day' | 'night';

export function lowLighting(result: WindowResult): CellLighting {
  return result.lowMs >= result.sunriseMs && result.lowMs <= result.sunsetMs ? 'day' : 'night';
}

/** How many of a spot's days are usable. Drives the default sort. */
export function countUsable(results: readonly WindowResult[]): number {
  return results.filter((r) => STATE_PRESENTATION[r.state].usable).length;
}
