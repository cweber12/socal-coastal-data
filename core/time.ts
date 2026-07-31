/**
 * Timezone primitives. Pure, no network, no ambient clock reads.
 *
 * Every instant in this app is an epoch-millisecond number, which is UTC by
 * definition and carries no zone. Wall-clock values only exist at two edges:
 * parsing an upstream payload (lib/tide.ts) and rendering to a person. Both
 * edges name their zone explicitly. There is no function here that reads a
 * "current" zone from the host, because the host running this is a server in an
 * unknown region and the corridor's zone is a property of the data, not of the
 * machine.
 */

/** A calendar date in some named zone. `month` is 1-12, not 0-11. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** A wall-clock instant in some named zone. */
export interface ZonedParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const PART_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23 rather than hour12:false: hour12:false is specified to produce a
      // 24-hour clock whose midnight reads as "24", which then parses as hour 24
      // and silently lands on the wrong day.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Break an instant into wall-clock parts in `timeZone`. */
export function zonedPartsFromUtc(utcMs: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const found: Partial<Record<(typeof PART_KEYS)[number], number>> = {};
  for (const p of parts) {
    if ((PART_KEYS as readonly string[]).includes(p.type)) {
      found[p.type as (typeof PART_KEYS)[number]] = Number(p.value);
    }
  }
  for (const k of PART_KEYS) {
    if (found[k] === undefined || !Number.isFinite(found[k])) {
      throw new Error(`zonedPartsFromUtc: Intl gave no usable ${k} for zone ${timeZone}`);
    }
  }
  return found as ZonedParts;
}

/** The zone's UTC offset, in ms, at a given instant. Positive east of UTC. */
export function zoneOffsetMsAt(utcMs: number, timeZone: string): number {
  const p = zonedPartsFromUtc(utcMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/**
 * Convert a wall-clock instant in `timeZone` to epoch ms.
 *
 * Two passes, because the offset depends on the instant we are trying to find.
 * The first pass uses the offset at the naive-UTC reading of the same digits;
 * the second corrects it. That matters within a day of a DST transition, where
 * the two offsets differ and a single pass lands an hour out.
 *
 * On a spring-forward gap the requested wall time does not exist; this returns
 * the instant one offset-step later rather than throwing. Callers in this app
 * only ever ask for local midnight, which exists on every US date because the
 * US transition is at 02:00.
 */
export function utcMsFromZoned(
  parts: LocalDate & Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second'>>,
  timeZone: string,
): number {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const firstPass = naive - zoneOffsetMsAt(naive, timeZone);
  return naive - zoneOffsetMsAt(firstPass, timeZone);
}

/** The calendar date an instant falls on, in `timeZone`. */
export function localDateInZone(utcMs: number, timeZone: string): LocalDate {
  const { year, month, day } = zonedPartsFromUtc(utcMs, timeZone);
  return { year, month, day };
}

/** Start of the local day, i.e. the instant local midnight occurs. */
export function startOfLocalDay(date: LocalDate, timeZone: string): number {
  return utcMsFromZoned({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
}

/**
 * The local day as a half-open interval `[start, end)`.
 *
 * The end is the next day's midnight rather than `start + 24h`: on a DST
 * boundary the local day is 23 or 25 hours long, and adding a fixed 24 either
 * clips an hour of tide off the day or double-counts one.
 */
export function localDayBounds(
  date: LocalDate,
  timeZone: string,
): { startMs: number; endMs: number } {
  return {
    startMs: startOfLocalDay(date, timeZone),
    endMs: startOfLocalDay(addLocalDays(date, 1), timeZone),
  };
}

/** Shift a calendar date by whole days. Calendar arithmetic, zone-independent. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Whole days from `a` to `b`. Negative when `b` precedes `a`. */
export function localDaysBetween(a: LocalDate, b: LocalDate): number {
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

export function sameLocalDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `2026-07-27`. The route segment form for a day. */
export function formatLocalDate(date: LocalDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/**
 * Parse `YYYY-MM-DD`, rejecting anything that is not that exact shape or that
 * does not round-trip. `2026-02-30` parses as a Date but is not a real day, and
 * a URL is untrusted input.
 */
export function parseLocalDate(input: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) throw new Error(`parseLocalDate: expected YYYY-MM-DD, got ${JSON.stringify(input)}`);
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (formatLocalDate(date) !== input) {
    throw new Error(`parseLocalDate: ${input} is not a real calendar date`);
  }
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    probe.getUTCFullYear() !== date.year ||
    probe.getUTCMonth() + 1 !== date.month ||
    probe.getUTCDate() !== date.day
  ) {
    throw new Error(`parseLocalDate: ${input} is not a real calendar date`);
  }
  return date;
}

/** Same shape as parseLocalDate but returns null instead of throwing. */
export function tryParseLocalDate(input: string): LocalDate | null {
  try {
    return parseLocalDate(input);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Rendering. Every formatter takes the zone as an argument -- none of them may
 * fall back to the host zone, which on a server is arbitrary.
 * ------------------------------------------------------------------------- */

function cachedFormat(
  key: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${key}|${timeZone}`;
  let f = formatterCache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    formatterCache.set(id, f);
  }
  return f;
}

/** `4:12 pm`. Lowercased because the grid is dense and caps shout. */
export function formatClock(utcMs: number, timeZone: string): string {
  return cachedFormat('clock', timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(utcMs))
    .replace(/ /g, ' ')
    .toLowerCase();
}

/** `Mon`. */
export function formatWeekdayShort(utcMs: number, timeZone: string): string {
  return cachedFormat('wdShort', timeZone, { weekday: 'short' }).format(new Date(utcMs));
}

/** `Monday`. For aria-labels, which should read as prose. */
export function formatWeekdayLong(utcMs: number, timeZone: string): string {
  return cachedFormat('wdLong', timeZone, { weekday: 'long' }).format(new Date(utcMs));
}

/** `27 Jul`. */
export function formatDayMonth(utcMs: number, timeZone: string): string {
  return cachedFormat('dayMonth', timeZone, { day: 'numeric', month: 'short' }).format(
    new Date(utcMs),
  );
}

/** `Monday 27 July`. */
export function formatDateLong(utcMs: number, timeZone: string): string {
  return cachedFormat('dateLong', timeZone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(utcMs));
}

/**
 * `27 Jul 2026, 4:12:07 pm PDT`. The evaluation stamp. Includes the zone
 * abbreviation deliberately: a stamp without one is the ambiguity this whole
 * module exists to remove.
 */
export function formatStamp(utcMs: number, timeZone: string): string {
  return cachedFormat('stamp', timeZone, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
    .format(new Date(utcMs))
    .replace(/ /g, ' ');
}

/** `1 h 36 min`, `45 min`. Durations in minutes, for window lengths. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}
