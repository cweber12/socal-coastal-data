/**
 * Text for the UI. Pure, so the sentences a screen reader gets are unit-tested
 * rather than assembled inline in JSX and never read back.
 *
 * Every cell in the grid is an interactive element, and a cell that announces
 * itself as "Windansea, one twelve, three fifty-nine, two fifteen" is unusable.
 * The aria-label is a whole sentence with the state named in words.
 *
 * ---------------------------------------------------------------------------
 * What a surf cell has to say that a tidepool cell does not
 * ---------------------------------------------------------------------------
 *
 * A tidepool cell reports one instant -- the low -- and one derived number, its
 * distance from the floor. A surf cell reports a LIST: two or three disjoint
 * sessions, each an interval, some of them bracketing a turn and some of them
 * not. So the spoken sentence is built by counting first and enumerating second,
 * because "Windansea, Wednesday: go. Two sessions." is a sentence a listener can
 * decide to stop listening to, and four unheralded clock ranges are not.
 */

import { formatThreshold, MINUS } from '../../core/format';
import { formatClock, formatDateLong, formatDuration, formatWeekdayLong, type LocalDate } from '../../core/time';
import { sessionLighting, type SurfDay, type SurfSession } from './policy';
import { STATE_PRESENTATION } from './states';

/**
 * A predicted tide height. `-0.6` becomes `−0.6`, with a true minus sign. For
 * display only.
 *
 * One decimal is right here and wrong for a threshold. A tide prediction carries
 * more digits than anyone can act on, so rounding it is a kindness; a threshold
 * is the number a verdict is computed from, so rounding it is a lie. Band edges
 * go through `formatThreshold` in core/format.ts.
 */
export function formatHeight(ft: number): string {
  const rounded = ft.toFixed(1);
  return rounded.startsWith('-') ? MINUS + rounded.slice(1) : rounded;
}

/**
 * Height for speech. "minus nought point six" is how a screen reader renders a
 * bare negative, which tells the listener nothing.
 */
export function describeHeight(ft: number): string {
  const magnitude = Math.abs(ft).toFixed(1);
  if (ft < 0) return `${magnitude} feet below the datum`;
  if (ft === 0) return 'exactly at the datum';
  return `${magnitude} feet above the datum`;
}

/**
 * The clock range of one session, with a redundant meridiem dropped.
 *
 * `1:32–7:23 pm` rather than `1:32 pm–7:23 pm`, and `11:32 am–1:23 pm` when they
 * genuinely differ. Not a stylistic preference — a width budget.
 *
 * The grid has to fit seven day columns plus a 181px spot column inside a
 * container that caps at 1360px, which leaves about 151px per column;
 * activities/tidepool/components/window-cell.tsx records the measurement and the
 * 13px it had spare. A surf cell prints a RANGE where a tidepool cell prints an
 * instant, so it starts about 60px over budget, and the first render of this
 * grid pushed the last two columns off the side of the page — which is exactly
 * the two columns that are `swell-tbd` by construction and most need to be seen.
 *
 * Three characters and a space, dropped on the roughly four sessions in five
 * that do not straddle noon or midnight.
 */
export function formatSessionClock(session: SurfSession, timeZone: string): string {
  const start = formatClock(session.startMs, timeZone);
  const end = formatClock(session.endMs, timeZone);
  const meridiem = / ([ap]m)$/i.exec(end)?.[1];
  return meridiem && start.endsWith(` ${meridiem}`)
    ? `${start.slice(0, -(meridiem.length + 1))}–${end}`
    : `${start}–${end}`;
}

/**
 * What a session brackets, in one or two words, for the cell face.
 *
 * The short form of `sessionAnchorLabel`. The spoken sentence gets the long one
 * — "around the low" reads as prose and "low" does not — and the cell gets this,
 * for the width reason above. Null for a pass-through in both.
 */
export function sessionAnchorShort(session: SurfSession): string | null {
  const kinds = session.anchors.map((a) => a.kind);
  if (kinds.length === 0) return null;
  if (kinds.length === 1) return kinds[0]!;
  return 'high + low';
}

/**
 * What a session brackets, in one word, or null when it brackets nothing.
 *
 * Null is the pass-through case -- the tide crossed the whole band on one ebb or
 * one flood without turning -- and it is common enough that it needs a name
 * rather than an empty string. The caller decides whether to print anything,
 * because "around the low" is useful next to a clock range and misleading on its
 * own.
 */
export function sessionAnchorLabel(session: SurfSession): string | null {
  const kinds = session.anchors.map((a) => a.kind);
  if (kinds.length === 0) return null;
  if (kinds.length === 1) return kinds[0] === 'low' ? 'around the low' : 'around the high';
  // Two turns inside one session: the band is holding a high and the low next to
  // it, which happens when the day's range is small. Named rather than reduced
  // to the first one, because "around the low" would be half true.
  return 'across a high and a low';
}

/** `2 h 15 min`, or the remaining time when the day is today. */
export function describeSessionLength(session: SurfSession, isToday: boolean): string {
  if (isToday && session.minutesRemaining !== null) {
    return `${formatDuration(session.minutesRemaining)} left`;
  }
  return formatDuration(session.usableMinutes);
}

/**
 * How many sessions, in words, with the band that produced them.
 *
 * Printed on the cell face and spoken. It is the one number that makes a surf
 * cell legible at a glance, and it is also the one that shows the band is doing
 * something: a corridor where every day gives the same count is a corridor where
 * the band is too wide to be saying anything.
 */
export function describeSessionCount(day: SurfDay): string {
  const n = day.sessions.length;
  if (n === 0) return 'no session in the band';
  return n === 1 ? '1 session' : `${n} sessions`;
}

/**
 * The full sentence for a grid cell.
 *
 * Reads as prose, names the state in words, and always says which day it is -- a
 * grid cell has no context of its own once focus lands on it.
 */
export function cellAriaLabel(spotName: string, day: SurfDay, timeZone: string): string {
  const { spoken } = STATE_PRESENTATION[day.state];
  const when = day.isToday ? 'today' : formatDateLong(day.sunriseMs, timeZone);

  const parts: string[] = [`${spotName}, ${when}: ${spoken}.`];

  if (day.sessions.length === 0) {
    // The reason already gives the day's range against the band in full, so
    // repeating the numbers here would make every out-of-band cell say them
    // twice. This is 24 rows' worth on a flat week.
    parts.push(day.reason);
    parts.push('Select for the day chart.');
    return parts.join(' ');
  }

  parts.push(`${describeSessionCount(day)} in the ${bandPhrase(day)} band.`);

  for (const session of day.sessions) {
    /*
     * The lighting is spoken because the cell says it with a background and
     * nothing else, and a surf day routinely carries one session in the light
     * and one after sunset -- which is the whole reason lighting is per session
     * here and per cell on the tidepool grid.
     */
    const lighting = sessionLighting(session, day) === 'day' ? 'in daylight' : 'after dark';
    const anchor = sessionAnchorLabel(session);
    parts.push(
      `${formatClock(session.startMs, timeZone)} to ${formatClock(session.endMs, timeZone)}, ` +
        `${lighting}${anchor ? `, ${anchor}` : ''}` +
        `${session.continuesBefore ? ', already under way at midnight' : ''}` +
        `${session.continuesAfter ? ', still running at midnight' : ''}.`,
    );
  }

  if (day.best && (day.state === 'go' || day.state === 'brief' || day.state === 'swell-tbd')) {
    parts.push(`Best is ${describeSessionLength(day.best, day.isToday)} of usable daylight.`);
  }

  parts.push(day.reason);
  parts.push('Select for the day chart.');

  return parts.join(' ');
}

/** `1.5 to 3.5 foot`, for a spoken sentence. */
function bandPhrase(day: SurfDay): string {
  return `${formatThreshold(day.band.minFt)} to ${formatThreshold(day.band.maxFt)} foot`;
}

/**
 * Label for the flag badge on a cell.
 *
 * Deliberately does NOT name the state. The badge is the affordance, not the
 * answer, and the cell it sits on already spoke the whole verdict through
 * `cellAriaLabel`.
 */
export function flagBadgeLabel(spotName: string, day: SurfDay, timeZone: string): string {
  const when = day.isToday ? 'today' : formatDateLong(day.sunriseMs, timeZone);
  return `Why this reading — ${spotName}, ${when}`;
}

/** Label for a cell that could not be evaluated. Absence, not a ninth state. */
export function unevaluatedAriaLabel(
  spotName: string,
  date: LocalDate,
  timeZone: string,
  dateMs: number,
): string {
  return (
    `${spotName}, ${formatWeekdayLong(dateMs, timeZone)} ` +
    `${date.day}: could not be evaluated. No sessions are shown for this day, which ` +
    'means unknown rather than unusable.'
  );
}

/** The heading for a spot's row, spoken. */
export function rowAriaLabel(spotName: string, usableCount: number, dayCount: number): string {
  const usable =
    usableCount === 0
      ? 'no usable days'
      : usableCount === 1
        ? '1 usable day'
        : `${usableCount} usable days`;
  return `${spotName}: ${usable} in the next ${dayCount} days. Select to expand this spot.`;
}

/**
 * Disclosure for the uncalibrated numbers, wherever they drive a decision.
 *
 * All THREE of them, every time. Tidepool's equivalent names a floor and a
 * ceiling, and its floor is at least a measured zone fact with an instrument
 * path to `verified`. Nothing on this page has one: the band, the ceiling and
 * the minimum are author estimates, and core/zones/surf.ts holds no measured
 * fact to put beside them. The sentence says so rather than leaving a reader to
 * infer that surf is as well-founded as the grid it sits next to.
 */
export function thresholdDisclosure(
  band: { minFt: number; maxFt: number },
  bandConfidence: string,
  ceilingFt: number,
  ceilingConfidence: string,
  minimumFt: number,
  minimumConfidence: string,
): string {
  /*
   * The swell window's two ends carry a confidence each, and printing both
   * unconditionally gave "(uncalibrated/uncalibrated)" -- a slash construction
   * that makes a reader stop and work out which half is which, to learn that
   * both halves say the same thing. Collapsed when they agree, which is every
   * value shipped today, and kept apart the moment one of them is promoted,
   * which is the only case where the distinction is worth the friction.
   */
  const swellConfidence =
    minimumConfidence === ceilingConfidence
      ? minimumConfidence
      : `${minimumConfidence} minimum, ${ceilingConfidence} ceiling`;

  return (
    `Tide band ${formatThreshold(band.minFt)}–${formatThreshold(band.maxFt)} ft ` +
    `(${bandConfidence}), swell ${formatThreshold(minimumFt)}–${formatThreshold(ceilingFt)} ft ` +
    `(${swellConfidence}). None has been field-checked, and the surf zone carries no measured ` +
    'fact behind them.'
  );
}
