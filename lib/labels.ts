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
import { STATE_PRESENTATION, type WindowResult } from './windows';

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

  parts.push(
    `Low ${describeHeight(result.lowFt)} at ${formatClock(result.lowMs, timeZone)}.`,
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
