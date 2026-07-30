/**
 * Operator gate hours, read from shared/gate-hours.json.
 *
 * A tide window is useless if the gate is shut. One spot in the inventory sits
 * inside a National Monument with published opening hours; the other 25 are open
 * beaches with no operator and no gate, and this module returns `null` for every
 * one of them so their window predicate is untouched. **This is not a fifth
 * gate.** It is a clip that applies where an operator publishes one.
 *
 * Deliberately not in spots.json, and deliberately not in thresholds.ts.
 *
 *   spots.json holds values resolved by join against an upstream authority and
 *   warns against hand-populating resolved fields. A gate rule is neither a join
 *   nor a value -- it is a conditional with a date-dependent branch and an input
 *   its own publisher does not publish.
 *
 *   thresholds.ts is for author guesses, and says so: "Nothing here is
 *   calibrated. Every value this module returns is labelled `uncalibrated`."
 *   These hours are the opposite of a guess. They are the operator's own
 *   published figures, read from nps.gov with page paths and read dates, and
 *   presenting them as uncalibrated would understate them exactly as badly as
 *   presenting a guess as measured would overstate it.
 *
 * **What is NOT applied, and why.** NPS publishes an extended-summer-hours rule
 * -- "the tidepools close 30 minutes before sunset or at 7:30 P.M., whichever is
 * earlier" -- and does not publish the dates on which it is in force. Applying
 * it would mean inventing a switchover date. The year-round 16:30 close is held
 * instead, which under-reports summer windows rather than over-reporting them: a
 * window called shut that was open costs a missed trip, and the reverse sends
 * someone to a locked gate. The asymmetry runs one way, as it does for floors.
 * The rule is carried verbatim in the JSON with `applied: false` and listed in
 * `unresolved`.
 */

import gateHoursJson from '@/shared/gate-hours.json';
import { startOfLocalDay, type LocalDate } from './time';

interface AnnualClosure {
  rule: string;
  name: string;
}

interface GateEntry {
  operator: string;
  opens: string;
  closes: string;
  annual_closures?: AnnualClosure[];
}

interface GateHoursFile {
  version: string;
  time_zone: string;
  gates: Record<string, GateEntry>;
  unresolved: string[];
}

const FILE = gateHoursJson as unknown as GateHoursFile;

/**
 * The gate for a day, resolved to instants.
 *
 * `closedAllDay` is a distinct outcome from a zero-length interval: it means the
 * operator does not open at all that day, and the reason names the holiday.
 */
export interface GateWindow {
  /** Slug this gate belongs to, for message text. */
  slug: string;
  operator: string;
  /** Gate open instant, UTC ms. Equal to `closeMs` when `closedAllDay`. */
  openMs: number;
  /** Gate close instant, UTC ms. */
  closeMs: number;
  closedAllDay: boolean;
  /** Set only when `closedAllDay` -- the published name of the closure. */
  closureName: string | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesFromHhmm(value: string, field: string, slug: string): number {
  const m = HHMM.exec(value);
  if (!m) {
    // A gate time that does not parse must not silently become midnight, which
    // would clip every window at that spot to nothing and read as "always shut".
    throw new Error(
      `shared/gate-hours.json: gates.${slug}.${field} is ${JSON.stringify(value)}, ` +
        'which is not an HH:MM wall-clock time. Refusing to guess.',
    );
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Resolve a named closure rule against a calendar date.
 *
 * Rules are named rather than dated because one of them moves: Thanksgiving is
 * the fourth Thursday in November, and a hard-coded date would be wrong every
 * year but one. An unrecognised rule throws rather than being skipped -- a
 * closure that silently stops applying is a gate that reports open on a day the
 * park is shut.
 */
export function closureFallsOn(rule: string, date: LocalDate): boolean {
  switch (rule) {
    case 'december-25':
      return date.month === 12 && date.day === 25;
    case 'fourth-thursday-november': {
      if (date.month !== 11) return false;
      // Calendar arithmetic in UTC, which is zone-independent for a weekday.
      const firstDow = new Date(Date.UTC(date.year, 10, 1)).getUTCDay(); // 0=Sun
      const firstThursday = 1 + ((4 - firstDow + 7) % 7);
      return date.day === firstThursday + 21;
    }
    default:
      throw new Error(
        `shared/gate-hours.json: unrecognised annual closure rule ${JSON.stringify(rule)}. ` +
          'Add it to closureFallsOn rather than letting a published closure lapse.',
      );
  }
}

/**
 * The gate for one spot on one day, or `null` where the spot has no operator
 * gate. `null` is the answer for 25 of the 26 spots and means "unclipped".
 */
export function gateWindowFor(
  slug: string,
  date: LocalDate,
  timeZone: string,
): GateWindow | null {
  const entry = FILE.gates[slug];
  if (!entry) return null;

  if (timeZone !== FILE.time_zone) {
    // The wall-clock times are published in the operator's zone. Resolving them
    // against a different zone would shift the gate by the offset between them.
    throw new Error(
      `shared/gate-hours.json declares time_zone ${JSON.stringify(FILE.time_zone)} but the ` +
        `window was evaluated in ${JSON.stringify(timeZone)}. Gate times are wall-clock and ` +
        'will not be resolved against a different zone.',
    );
  }

  const dayStartMs = startOfLocalDay(date, timeZone);
  const openMin = minutesFromHhmm(entry.opens, 'opens', slug);
  const closeMin = minutesFromHhmm(entry.closes, 'closes', slug);
  if (closeMin <= openMin) {
    throw new Error(
      `shared/gate-hours.json: gates.${slug} closes at ${entry.closes} which is not after ` +
        `opens at ${entry.opens}.`,
    );
  }

  for (const closure of entry.annual_closures ?? []) {
    if (closureFallsOn(closure.rule, date)) {
      const at = dayStartMs + openMin * 60_000;
      return {
        slug,
        operator: entry.operator,
        openMs: at,
        closeMs: at,
        closedAllDay: true,
        closureName: closure.name,
      };
    }
  }

  return {
    slug,
    operator: entry.operator,
    openMs: dayStartMs + openMin * 60_000,
    closeMs: dayStartMs + closeMin * 60_000,
    closedAllDay: false,
    closureName: null,
  };
}

/** Every unresolved item in the file, for the UI to surface rather than hide. */
export function gateUnresolved(): readonly string[] {
  return FILE.unresolved;
}

/** Slugs carrying an operator gate. One today; the predicate must not assume that. */
export function gatedSlugs(): readonly string[] {
  return Object.keys(FILE.gates);
}
