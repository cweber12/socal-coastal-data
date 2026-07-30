import { describe, expect, it } from 'vitest';

import { closureFallsOn, gateWindowFor, gatedSlugs, gateUnresolved } from './gate-hours';
import { zonedPartsFromUtc, type LocalDate } from './time';

const ZONE = 'America/Los_Angeles';

const d = (year: number, month: number, day: number): LocalDate => ({ year, month, day });

describe('gateWindowFor', () => {
  it('returns null for a spot with no operator gate', () => {
    // 25 of the 26 spots are open beaches. Null means unclipped, and it is what
    // keeps this from becoming a fifth gate evaluated for all of them.
    expect(gateWindowFor('la-jolla-shores', d(2026, 7, 30), ZONE)).toBeNull();
    expect(gateWindowFor('swamis', d(2026, 7, 30), ZONE)).toBeNull();
    expect(gateWindowFor('not-a-slug', d(2026, 7, 30), ZONE)).toBeNull();
  });

  it('resolves Cabrillo to 09:00-16:30 local wall clock', () => {
    const gate = gateWindowFor('cabrillo-tidepools', d(2026, 7, 30), ZONE);
    expect(gate).not.toBeNull();
    const open = zonedPartsFromUtc(gate!.openMs, ZONE);
    const close = zonedPartsFromUtc(gate!.closeMs, ZONE);
    expect([open.hour, open.minute]).toEqual([9, 0]);
    expect([close.hour, close.minute]).toEqual([16, 30]);
    expect(gate!.closedAllDay).toBe(false);
  });

  it('holds the same wall-clock times across the DST boundary', () => {
    // The published times are wall clock. If they were stored as an offset from
    // midnight UTC the gate would shift an hour twice a year.
    for (const date of [d(2026, 1, 15), d(2026, 7, 15)]) {
      const gate = gateWindowFor('cabrillo-tidepools', date, ZONE)!;
      expect(zonedPartsFromUtc(gate.openMs, ZONE).hour).toBe(9);
      expect(zonedPartsFromUtc(gate.closeMs, ZONE).hour).toBe(16);
    }
  });

  it('reports the two published annual closures as closed all day', () => {
    const xmas = gateWindowFor('cabrillo-tidepools', d(2026, 12, 25), ZONE)!;
    expect(xmas.closedAllDay).toBe(true);
    expect(xmas.closureName).toBe('Christmas Day');
    // A zero-length interval, so any window clipped against it is empty.
    expect(xmas.openMs).toBe(xmas.closeMs);

    // Thanksgiving 2026 is 26 November.
    const thanks = gateWindowFor('cabrillo-tidepools', d(2026, 11, 26), ZONE)!;
    expect(thanks.closedAllDay).toBe(true);
    expect(thanks.closureName).toBe('Thanksgiving Day');
  });

  it('refuses a time zone the file was not published in', () => {
    // Wall-clock times resolved against the wrong zone shift the gate silently.
    expect(() => gateWindowFor('cabrillo-tidepools', d(2026, 7, 30), 'UTC')).toThrow(
      /wall-clock and will not be resolved against a different zone/,
    );
  });

  it('does not apply the unpublished summer rule', () => {
    // NPS publishes "30 minutes before sunset or 7:30 P.M." and does not publish
    // the dates it is in force. Applying it would mean inventing a switchover.
    // Holding 16:30 under-reports summer windows, which is the safe direction.
    const midsummer = gateWindowFor('cabrillo-tidepools', d(2026, 7, 4), ZONE)!;
    expect(zonedPartsFromUtc(midsummer.closeMs, ZONE).hour).toBe(16);
    expect(gateUnresolved().join(' ')).toMatch(/extended summer hours/i);
  });
});

describe('closureFallsOn', () => {
  it('finds the fourth Thursday of November across years', () => {
    // Hard-coding a date would be wrong every year but one.
    const expected: Record<number, number> = {
      2024: 28,
      2025: 27,
      2026: 26,
      2027: 25,
      2028: 23,
    };
    for (const [year, day] of Object.entries(expected)) {
      expect(closureFallsOn('fourth-thursday-november', d(Number(year), 11, day))).toBe(true);
      expect(closureFallsOn('fourth-thursday-november', d(Number(year), 11, day - 7))).toBe(false);
      expect(closureFallsOn('fourth-thursday-november', d(Number(year), 11, day + 1))).toBe(false);
    }
  });

  it('matches Christmas only in December', () => {
    expect(closureFallsOn('december-25', d(2026, 12, 25))).toBe(true);
    expect(closureFallsOn('december-25', d(2026, 11, 25))).toBe(false);
  });

  it('throws on an unrecognised rule rather than skipping it', () => {
    // A closure that silently stops applying is a gate reporting open on a day
    // the park is shut, which is the failure mode this whole issue is about.
    expect(() => closureFallsOn('easter-monday', d(2026, 4, 6))).toThrow(/unrecognised annual/);
  });
});

describe('the file itself', () => {
  it('gates exactly one slug today, and it is Cabrillo', () => {
    // Not an assertion that it must stay one. It is an assertion that adding a
    // second is a deliberate act that has to come past this test.
    expect(gatedSlugs()).toEqual(['cabrillo-tidepools']);
  });

  it('lists the unpublished switchover as unresolved rather than encoding a guess', () => {
    expect(gateUnresolved().length).toBeGreaterThan(0);
  });
});
