/**
 * Text for the UI. Pure, so the sentences a screen reader gets are unit-tested
 * rather than assembled inline in JSX and never read back.
 *
 * Every cell in the grid is an interactive element, and a cell that announces
 * itself as "Cabrillo, minus zero point four, three twenty-one" is unusable. The
 * aria-label is a whole sentence with the state named in words, because colour
 * and a glyph are not available to a screen reader and "green" is not a fact
 * about the tide.
 */

import { formatClock, formatDateLong, formatDuration, formatWeekdayLong, type LocalDate } from './time';
import { lowLighting, STATE_PRESENTATION, type WindowResult } from './windows';

/** U+2212 MINUS SIGN, not a hyphen: it aligns with digits and reads as a sign. */
const MINUS = '−';

/** `-0.6` becomes `−0.6`, with a true minus sign. For display only. */
export function formatHeight(ft: number): string {
  const rounded = ft.toFixed(1);
  return rounded.startsWith('-') ? MINUS + rounded.slice(1) : rounded;
}

/**
 * Height for speech. "minus nought point six" is how a screen reader renders a
 * bare negative, which tells the listener nothing; below-datum is the fact that
 * matters for whether a reef is exposed.
 */
export function describeHeight(ft: number): string {
  const magnitude = Math.abs(ft).toFixed(1);
  if (ft < 0) return `${magnitude} feet below the datum`;
  if (ft === 0) return 'exactly at the datum';
  return `${magnitude} feet above the datum`;
}

/**
 * The low's distance from the reef floor, for display in a cell.
 *
 * Signed, and the sign convention follows the tide rather than the verdict:
 * negative means the low gets UNDER the floor, which is the direction that
 * uncovers reef. That matches the ▼ next to it and matches heights below the
 * datum already printing negative, so one reading of "lower is further down"
 * holds across every number in the cell.
 *
 * True U+2212 for the minus, and an explicit `+` for the over case, so both
 * signs occupy one character and a column of these stays aligned. Without the
 * explicit plus the positive values shift left by a glyph and the column combs.
 */
export function formatFloorGap(lowFt: number, floorFt: number): string {
  const gap = lowFt - floorFt;
  // -0.04 would render "−0.0", which reads as under-floor when it is not.
  const rounded = Number(gap.toFixed(1));
  /*
   * At the floor, to within the tenth of a foot this prints, neither sign is
   * true. "+0.0" claims the low is over the floor and "−0.0" claims it is
   * under, and on a real week both appear -- Swami's and Torrey Pines both read
   * +0.0 on 3 August against 0.9 ft floors. An unsigned zero says what is
   * actually known: the low and the floor agree to the precision shown.
   */
  if (rounded === 0) return '0.0';
  if (rounded < 0) return MINUS + Math.abs(rounded).toFixed(1);
  return '+' + rounded.toFixed(1);
}

/**
 * The same distance, for speech, or null when it must not be spoken.
 *
 * Null for `above-floor`, which is 49 of 56 cells in a typical week here.
 * `result.reason` already gives both numbers and the relationship between them
 * -- "only reaches 2.4 ft, which does not get under the 1.3 ft floor" -- and
 * cellAriaLabel speaks the reason in full. Adding the subtraction as well would
 * make every covered cell announce the same fact twice.
 *
 * When the tide DOES reach the floor no reason string carries the number, so
 * this is the only place a listener gets it.
 */
export function describeFloorGap(result: WindowResult): string | null {
  if (!result.reachesFloor) return null;
  const under = Math.abs(result.floorFt - result.lowFt);
  /*
   * The gap only, never the floor's own value.
   *
   * Floors here run negative -- Sunset Cliffs sits at -0.8 in some revisions --
   * and "the -0.2 foot floor" is spoken as "minus zero point two foot floor",
   * which is the exact failure describeHeight exists upstream to prevent. The
   * gap is the actionable number; the floor itself is on the page in the row
   * header and in the threshold disclosure, both as text.
   */
  return `${under.toFixed(1)} feet under the floor`;
}

/** `1 h 36 min` of window, or the remaining time when the day is today. */
export function describeWindowLength(result: WindowResult): string {
  if (result.isToday && result.minutesRemaining !== null) {
    return `${formatDuration(result.minutesRemaining)} of window left`;
  }
  return `${formatDuration(result.usableMinutes)} of daylight window`;
}

/**
 * The full sentence for a grid or ribbon cell.
 *
 * Reads as prose, names the state in words, and always says which day it is --
 * a grid cell has no context of its own once focus lands on it.
 */
export function cellAriaLabel(
  spotName: string,
  result: WindowResult,
  timeZone: string,
): string {
  const { spoken } = STATE_PRESENTATION[result.state];
  const day = result.isToday
    ? 'today'
    : formatDateLong(result.lowMs, timeZone);

  const parts: string[] = [`${spotName}, ${day}: ${spoken}.`];

  /*
   * The lighting is spoken because the cell says it with a background colour and
   * nothing else. A light cell and a dark one are the only difference between two
   * otherwise identical cells, so leaving it out would make them identical to a
   * listener. Says "after dark" rather than naming the colour: the fact is about
   * the sun, not about the pixel.
   */
  const lighting = lowLighting(result) === 'day' ? 'in daylight' : 'after dark';

  /*
   * The floor gap rides on the low's own sentence rather than getting one of
   * its own, because it is a fact ABOUT that low and not a separate reading.
   * describeFloorGap returns null for `above-floor`, where result.reason --
   * pushed below in full -- already states both numbers.
   */
  const gap = describeFloorGap(result);
  parts.push(
    `Low ${describeHeight(result.lowFt)} at ${formatClock(result.lowMs, timeZone)}, ${lighting}` +
      `${gap ? `, ${gap}` : ''}.`,
  );

  if (result.nextHighMs !== null && result.nextHighFt !== null) {
    parts.push(
      `Next high ${describeHeight(result.nextHighFt)} at ${formatClock(result.nextHighMs, timeZone)}.`,
    );
  }

  if (result.state === 'go' || result.state === 'brief' || result.state === 'swell-tbd') {
    parts.push(`${describeWindowLength(result)}.`);
  }

  parts.push(result.reason);
  parts.push('Select for the day chart.');

  return parts.join(' ');
}

/**
 * Label for the flag badge on a cell.
 *
 * Deliberately does NOT name the state. The badge is the affordance, not the
 * answer, and the cell it sits on already spoke the whole verdict through
 * `cellAriaLabel` -- a badge that repeated it would make every cell announce its
 * state twice. What this adds is which cell the button belongs to, which is the
 * one thing focus on a bare button in a grid does not tell you.
 */
export function flagBadgeLabel(
  spotName: string,
  result: WindowResult,
  timeZone: string,
): string {
  const day = result.isToday ? 'today' : formatDateLong(result.lowMs, timeZone);
  return `Why this reading — ${spotName}, ${day}`;
}

/** Label for a cell that could not be evaluated. Absence, not a seventh state. */
export function unevaluatedAriaLabel(
  spotName: string,
  date: LocalDate,
  timeZone: string,
  dateMs: number,
): string {
  return (
    `${spotName}, ${formatWeekdayLong(dateMs, timeZone)} ` +
    `${date.day}: could not be evaluated. No tide window is shown for this day, which ` +
    'means unknown rather than unusable.'
  );
}

/** The heading for a spot's row, spoken. */
export function rowAriaLabel(spotName: string, usableCount: number, dayCount: number): string {
  const usable =
    usableCount === 0
      ? 'no usable windows'
      : usableCount === 1
        ? '1 usable window'
        : `${usableCount} usable windows`;
  return `${spotName}: ${usable} in the next ${dayCount} days. Select to expand this spot's week.`;
}

/**
 * Disclosure for an uncalibrated threshold, wherever one drives a decision.
 *
 * Both the floor and the ceiling are author estimates. spots.json flags Sunset
 * Cliffs specifically as a ledge system with cliff access where a wrong floor
 * strands people, so this is not boilerplate.
 */
export function thresholdDisclosure(
  floorFt: number,
  floorConfidence: string,
  ceilingFt: number,
  ceilingConfidence: string,
): string {
  return (
    `Floor ${formatHeight(floorFt)} ft (${floorConfidence}), ` +
    `swell ceiling ${ceilingFt.toFixed(1)} ft (${ceilingConfidence}). ` +
    'Neither has been field-checked.'
  );
}
