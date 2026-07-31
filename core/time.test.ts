import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  formatClock,
  formatDuration,
  formatLocalDate,
  formatStamp,
  localDateInZone,
  localDayBounds,
  localDaysBetween,
  parseLocalDate,
  sameLocalDate,
  startOfLocalDay,
  tryParseLocalDate,
  utcMsFromZoned,
  zonedPartsFromUtc,
  zoneOffsetMsAt,
} from './time';

const ZONE = 'America/Los_Angeles';
const iso = (ms: number) => new Date(ms).toISOString();

/*
 * America/Los_Angeles in 2026:
 *   PDT begins Sunday 8 March,   02:00 PST -> 03:00 PDT  (that local day is 23 h)
 *   PDT ends   Sunday 1 November, 02:00 PDT -> 01:00 PST  (that local day is 25 h)
 *
 * Both transitions are at 02:00, so local midnight always exists and is always
 * unambiguous. The grid's day columns are local days, so a 23- or 25-hour day
 * that is treated as 24 either clips an hour of tide or double-counts one.
 */

describe('zonedPartsFromUtc', () => {
  it('reads Pacific wall time from an instant', () => {
    // 2026-07-27T19:55:34Z is solar noon at La Jolla, i.e. 12:55:34 PDT.
    expect(zonedPartsFromUtc(Date.parse('2026-07-27T19:55:34Z'), ZONE)).toEqual({
      year: 2026,
      month: 7,
      day: 27,
      hour: 12,
      minute: 55,
      second: 34,
    });
  });

  it('reports midnight as hour 0, not hour 24', () => {
    // hourCycle h23 rather than hour12:false. hour12:false yields "24" for
    // midnight in some ICU versions, which parses as hour 24 and lands the
    // instant on the following day.
    const midnight = Date.parse('2026-07-27T07:00:00Z'); // 00:00 PDT on the 27th
    const parts = zonedPartsFromUtc(midnight, ZONE);
    expect(parts.hour).toBe(0);
    expect(parts.day).toBe(27);
  });
});

describe('zoneOffsetMsAt', () => {
  it('is -8 h in PST and -7 h in PDT', () => {
    expect(zoneOffsetMsAt(Date.parse('2026-01-15T20:00:00Z'), ZONE)).toBe(-8 * 3_600_000);
    expect(zoneOffsetMsAt(Date.parse('2026-07-15T20:00:00Z'), ZONE)).toBe(-7 * 3_600_000);
  });
});

describe('utcMsFromZoned', () => {
  it('converts Pacific wall time to an instant in both offsets', () => {
    expect(iso(utcMsFromZoned({ year: 2026, month: 7, day: 27, hour: 0 }, ZONE))).toBe(
      '2026-07-27T07:00:00.000Z',
    );
    expect(iso(utcMsFromZoned({ year: 2026, month: 1, day: 27, hour: 0 }, ZONE))).toBe(
      '2026-01-27T08:00:00.000Z',
    );
  });

  it('round-trips through zonedPartsFromUtc', () => {
    const instants = [
      '2026-03-07T12:00:00Z',
      '2026-03-08T12:00:00Z', // spring forward
      '2026-06-21T04:30:00Z',
      '2026-11-01T12:00:00Z', // fall back
      '2026-12-21T23:59:00Z',
    ];
    for (const i of instants) {
      const ms = Date.parse(i);
      const parts = zonedPartsFromUtc(ms, ZONE);
      expect(iso(utcMsFromZoned(parts, ZONE)), `round trip of ${i}`).toBe(iso(ms));
    }
  });

  it('needs its second pass: a single pass misplaces times near a transition', () => {
    // 2026-03-08 12:00 local is PDT (UTC-7) => 19:00Z. Reading the offset at the
    // naive-UTC instant 2026-03-08T12:00Z gives PST (-8), because 04:00 local on
    // that date is still before the 02:00 switch... and the switch has happened
    // by 12:00 local. The two-pass form is what resolves this.
    expect(iso(utcMsFromZoned({ year: 2026, month: 3, day: 8, hour: 12 }, ZONE))).toBe(
      '2026-03-08T19:00:00.000Z',
    );
    expect(iso(utcMsFromZoned({ year: 2026, month: 11, day: 1, hour: 12 }, ZONE))).toBe(
      '2026-11-01T20:00:00.000Z',
    );
  });
});

describe('localDateInZone', () => {
  it('assigns an instant to the local day, not the UTC day', () => {
    // 06:00Z on the 27th is 23:00 PDT on the 26th. A tide low at this instant
    // belongs in the 26th's column. Using the UTC date would file it under the
    // 27th and the grid would show the wrong day's best low.
    expect(localDateInZone(Date.parse('2026-07-27T06:00:00Z'), ZONE)).toEqual({
      year: 2026,
      month: 7,
      day: 26,
    });
    expect(localDateInZone(Date.parse('2026-07-27T07:00:00Z'), ZONE)).toEqual({
      year: 2026,
      month: 7,
      day: 27,
    });
  });

  it('files the 27 July pre-dawn low under the 27th', () => {
    // The corridor's low that day is 10:21Z, which is 03:21 PDT on the 27th.
    expect(localDateInZone(Date.parse('2026-07-27T10:21:00Z'), ZONE)).toEqual({
      year: 2026,
      month: 7,
      day: 27,
    });
  });
});

describe('localDayBounds', () => {
  it('is 24 h on an ordinary day', () => {
    const { startMs, endMs } = localDayBounds({ year: 2026, month: 7, day: 27 }, ZONE);
    expect(iso(startMs)).toBe('2026-07-27T07:00:00.000Z');
    expect((endMs - startMs) / 3_600_000).toBe(24);
  });

  it('is 23 h on the spring-forward day', () => {
    const { startMs, endMs } = localDayBounds({ year: 2026, month: 3, day: 8 }, ZONE);
    expect(iso(startMs)).toBe('2026-03-08T08:00:00.000Z'); // midnight PST
    expect(iso(endMs)).toBe('2026-03-09T07:00:00.000Z'); // midnight PDT
    expect((endMs - startMs) / 3_600_000).toBe(23);
  });

  it('is 25 h on the fall-back day', () => {
    const { startMs, endMs } = localDayBounds({ year: 2026, month: 11, day: 1 }, ZONE);
    expect(iso(startMs)).toBe('2026-11-01T07:00:00.000Z'); // midnight PDT
    expect(iso(endMs)).toBe('2026-11-02T08:00:00.000Z'); // midnight PST
    expect((endMs - startMs) / 3_600_000).toBe(25);
  });

  it('tiles consecutive days with no gap and no overlap', () => {
    // Across both transitions: each day's end must be exactly the next day's
    // start. A fixed +24 h would leave a one-hour hole in March and a one-hour
    // double-count in November.
    let date = { year: 2026, month: 3, day: 1 };
    for (let i = 0; i < 250; i++) {
      const a = localDayBounds(date, ZONE);
      const next = addLocalDays(date, 1);
      const b = localDayBounds(next, ZONE);
      expect(a.endMs, `${formatLocalDate(date)} -> ${formatLocalDate(next)}`).toBe(b.startMs);
      date = next;
    }
  });
});

describe('addLocalDays and localDaysBetween', () => {
  it('crosses months, years and leap days', () => {
    expect(addLocalDays({ year: 2026, month: 7, day: 31 }, 1)).toEqual({ year: 2026, month: 8, day: 1 });
    expect(addLocalDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addLocalDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addLocalDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({ year: 2026, month: 3, day: 1 });
    expect(addLocalDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 31 });
  });

  it('counts whole days across a DST transition as whole days', () => {
    // Calendar arithmetic, not elapsed time. 8 March is 23 h long but it is
    // still one day after 7 March.
    expect(localDaysBetween({ year: 2026, month: 3, day: 7 }, { year: 2026, month: 3, day: 8 })).toBe(1);
    expect(localDaysBetween({ year: 2026, month: 11, day: 1 }, { year: 2026, month: 11, day: 2 })).toBe(1);
    expect(localDaysBetween({ year: 2026, month: 7, day: 27 }, { year: 2026, month: 8, day: 3 })).toBe(7);
    expect(localDaysBetween({ year: 2026, month: 8, day: 3 }, { year: 2026, month: 7, day: 27 })).toBe(-7);
    expect(localDaysBetween({ year: 2026, month: 7, day: 27 }, { year: 2026, month: 7, day: 27 })).toBe(0);
  });

  it('agrees with startOfLocalDay on the horizon a week out', () => {
    const today = { year: 2026, month: 10, day: 29 };
    const seventh = addLocalDays(today, 6);
    expect(formatLocalDate(seventh)).toBe('2026-11-04');
    // Crossing the November transition, so the elapsed time is 6 days plus an
    // hour. The day count is still 6.
    expect(localDaysBetween(today, seventh)).toBe(6);
    const elapsedH = (startOfLocalDay(seventh, ZONE) - startOfLocalDay(today, ZONE)) / 3_600_000;
    expect(elapsedH).toBe(6 * 24 + 1);
  });
});

describe('parseLocalDate', () => {
  it('parses a well-formed date', () => {
    expect(parseLocalDate('2026-07-27')).toEqual({ year: 2026, month: 7, day: 27 });
    expect(formatLocalDate(parseLocalDate('2026-07-27'))).toBe('2026-07-27');
  });

  it('rejects dates that do not exist, which a URL can carry', () => {
    // new Date('2026-02-30') is not an error in JS; it rolls to 2 March. A route
    // segment is untrusted input and must not roll.
    expect(() => parseLocalDate('2026-02-30')).toThrow(/not a real calendar date/);
    expect(() => parseLocalDate('2026-13-01')).toThrow(/not a real calendar date/);
    expect(() => parseLocalDate('2026-00-10')).toThrow(/not a real calendar date/);
    expect(() => parseLocalDate('2026-04-31')).toThrow(/not a real calendar date/);
  });

  it('accepts a real leap day and rejects a false one', () => {
    expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(() => parseLocalDate('2026-02-29')).toThrow(/not a real calendar date/);
  });

  it('rejects shapes that are not YYYY-MM-DD', () => {
    for (const bad of ['2026-7-27', '20260727', '27-07-2026', '2026/07/27', '', 'today', '2026-07-27T00:00:00Z']) {
      expect(() => parseLocalDate(bad), `should reject ${JSON.stringify(bad)}`).toThrow();
    }
  });

  it('tryParseLocalDate returns null instead of throwing', () => {
    expect(tryParseLocalDate('2026-07-27')).toEqual({ year: 2026, month: 7, day: 27 });
    expect(tryParseLocalDate('2026-02-30')).toBeNull();
    expect(tryParseLocalDate('nonsense')).toBeNull();
  });
});

describe('sameLocalDate', () => {
  it('compares all three fields', () => {
    expect(sameLocalDate({ year: 2026, month: 7, day: 27 }, { year: 2026, month: 7, day: 27 })).toBe(true);
    expect(sameLocalDate({ year: 2026, month: 7, day: 27 }, { year: 2026, month: 8, day: 27 })).toBe(false);
    expect(sameLocalDate({ year: 2026, month: 7, day: 27 }, { year: 2027, month: 7, day: 27 })).toBe(false);
  });
});

describe('formatters', () => {
  it('renders a clock time in the corridor zone, not the host zone', () => {
    // 2026-07-27T21:16:00Z is the afternoon low, 14:16 PDT.
    expect(formatClock(Date.parse('2026-07-27T21:16:00Z'), ZONE)).toBe('2:16 pm');
    expect(formatClock(Date.parse('2026-07-27T07:00:00Z'), ZONE)).toBe('12:00 am');
    expect(formatClock(Date.parse('2026-07-27T19:00:00Z'), ZONE)).toBe('12:00 pm');
  });

  it('names the zone in the evaluation stamp', () => {
    // A stamp without a zone is the ambiguity the module exists to remove.
    expect(formatStamp(Date.parse('2026-07-27T21:16:07Z'), ZONE)).toContain('PDT');
    expect(formatStamp(Date.parse('2026-01-27T21:16:07Z'), ZONE)).toContain('PST');
    expect(formatStamp(Date.parse('2026-07-27T21:16:07Z'), ZONE)).toContain('2:16:07');
  });

  it('formats durations the way a window reads', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(44)).toBe('44 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(96)).toBe('1 h 36 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(-5)).toBe('0 min');
  });
});
