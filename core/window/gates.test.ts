import { describe, expect, it } from 'vitest';

import {
  assertSeriesCoversDay,
  clipToGates,
  darkReason,
  daylightGate,
  gateClosedReason,
  gateVerdict,
  MIN_USABLE_MINUTES,
  readSwell,
  swellFlatReason,
  swellUnknownReason,
  swellVetoReason,
  SWELL_HORIZON_DAYS,
  type SwellReading,
} from './gates';
import { gateWindowFor } from '../spot/access';
import { localDayBounds, type LocalDate } from '../time';
import { pacific, seriesFromTurns, ZONE } from './__testing__/series';

/** La Jolla Shores. Sunrise 05:59:27, sunset 19:51:17 PDT on 2026-07-27. */
const LAT = 32.8669;
const LON = -117.2571;

const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };
const { startMs: DAY_START, endMs: DAY_END } = localDayBounds(TODAY, ZONE);
const { sunriseMs, sunsetMs } = daylightGate(LAT, LON, TODAY, DAY_START, DAY_END);

const ctx = (over: Partial<Parameters<typeof clipToGates>[2]> = {}) => ({
  sunriseMs,
  sunsetMs,
  gate: null,
  nowMs: pacific(TODAY, 8),
  isToday: false,
  ...over,
});

/* =========================================================================
 * Constants
 * ======================================================================= */

describe('constants', () => {
  it('are the values the design specifies', () => {
    expect(MIN_USABLE_MINUTES).toBe(45);
    expect(SWELL_HORIZON_DAYS).toBe(5);
  });
});

/* =========================================================================
 * The daylight gate
 * ======================================================================= */

describe('daylightGate', () => {
  it('places sunrise and sunset where USNO puts them for the day', () => {
    // 05:59 and 19:51 PDT on 2026-07-27, from aa.usno.navy.mil.
    expect(sunriseMs).toBeGreaterThan(pacific(TODAY, 5, 58));
    expect(sunriseMs).toBeLessThan(pacific(TODAY, 6, 0));
    expect(sunsetMs).toBeGreaterThan(pacific(TODAY, 19, 50));
    expect(sunsetMs).toBeLessThan(pacific(TODAY, 19, 52));
  });

  it('collapses a never-rising day to one instant, so every window measures zero', () => {
    // Cannot arise in this corridor, and is handled rather than allowed to
    // become a NaN window. Utqiagvik in December.
    const midwinter: LocalDate = { year: 2026, month: 12, day: 21 };
    const bounds = localDayBounds(midwinter, 'America/Anchorage');
    const polar = daylightGate(71.29, -156.79, midwinter, bounds.startMs, bounds.endMs);
    expect(polar.sunriseMs).toBe(polar.sunsetMs);
    expect(clipToGates(bounds.startMs, bounds.endMs, { ...ctx(), ...polar }).usableMinutes).toBe(0);
  });

  it('gives a never-setting day the whole of it', () => {
    const midsummer: LocalDate = { year: 2026, month: 6, day: 21 };
    const bounds = localDayBounds(midsummer, 'America/Anchorage');
    const polar = daylightGate(71.29, -156.79, midsummer, bounds.startMs, bounds.endMs);
    expect(polar.sunriseMs).toBe(bounds.startMs);
    expect(polar.sunsetMs).toBe(bounds.endMs);
  });
});

/* =========================================================================
 * The two clips
 * ======================================================================= */

describe('clipToGates', () => {
  it('clips to daylight without moving the window it was given', () => {
    const clip = clipToGates(pacific(TODAY, 3), pacific(TODAY, 9), ctx());
    expect(clip.usableStartMs).toBe(sunriseMs);
    expect(clip.usableEndMs).toBe(pacific(TODAY, 9));
    expect(clip.usableMinutes).toBeCloseTo((pacific(TODAY, 9) - sunriseMs) / 60_000, 6);
  });

  it('is zero minutes when the window and the daylight do not overlap', () => {
    const clip = clipToGates(pacific(TODAY, 1), pacific(TODAY, 4), ctx());
    expect(clip.usableMinutes).toBe(0);
    // and no gate was involved, so nothing claims one was
    expect(clip.gateBlocked).toBe(false);
  });

  it('applies the operator gate after daylight, and says which one shut it', () => {
    /*
     * The distinction `closed` and `dark` rest on, and the reason the two clips
     * are measured separately rather than composed. A 06:30 window is broad
     * daylight and three hours before Cabrillo's gate opens; a 02:30 window is
     * dark whether or not there is a gate.
     */
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    expect(gate, 'cabrillo-tidepools must still carry a gate for this test to mean anything')
      .not.toBeNull();

    const daylightButGated = clipToGates(pacific(TODAY, 6), pacific(TODAY, 8), ctx({ gate }));
    expect(daylightButGated.usableMinutes).toBe(0);
    expect(daylightButGated.gateBlocked).toBe(true);

    const darkAndGated = clipToGates(pacific(TODAY, 1), pacific(TODAY, 4), ctx({ gate }));
    expect(darkAndGated.usableMinutes).toBe(0);
    // Daylight had already emptied it, so the gate gets no claim on it.
    expect(darkAndGated.gateBlocked).toBe(false);
  });

  it('counts a closed-all-day gate however the light falls', () => {
    const xmas: LocalDate = { year: 2026, month: 12, day: 25 };
    const bounds = localDayBounds(xmas, ZONE);
    const gate = gateWindowFor('cabrillo-tidepools', xmas, ZONE)!;
    expect(gate.closedAllDay).toBe(true);
    const light = daylightGate(LAT, LON, xmas, bounds.startMs, bounds.endMs);
    const clip = clipToGates(
      pacific(xmas, 2),
      pacific(xmas, 4),
      { ...ctx({ gate }), ...light },
    );
    // The park does not open at all, which is not a fact about daylight.
    expect(clip.gateBlocked).toBe(true);
  });

  it('leaves a window inside gate hours exactly as it was', () => {
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    const gated = clipToGates(pacific(TODAY, 11), pacific(TODAY, 14), ctx({ gate }));
    const ungated = clipToGates(pacific(TODAY, 11), pacific(TODAY, 14), ctx());
    expect(gated).toEqual(ungated);
  });

  it('leaves minutesRemaining null on days that are not today', () => {
    expect(clipToGates(pacific(TODAY, 11), pacific(TODAY, 14), ctx()).minutesRemaining).toBeNull();
  });

  it('reports the whole window before it opens, not the time until it shuts', () => {
    // The naive reading -- time from now until the window closes -- would be an
    // hour longer here and would overstate what is actually workable.
    const clip = clipToGates(
      pacific(TODAY, 11),
      pacific(TODAY, 14),
      ctx({ isToday: true, nowMs: pacific(TODAY, 10) }),
    );
    expect(clip.minutesRemaining).toBeCloseTo(clip.usableMinutes, 6);
    expect(clip.minutesRemaining!).toBeCloseTo((pacific(TODAY, 14) - pacific(TODAY, 10)) / 60_000 - 60, 6);
  });

  it('counts remaining from now once now is inside, holding usableMinutes steady', () => {
    // The distinction the UI needs to say "1 h 36 min window, 42 min left".
    const inside = clipToGates(
      pacific(TODAY, 11),
      pacific(TODAY, 14),
      ctx({ isToday: true, nowMs: pacific(TODAY, 13) }),
    );
    expect(inside.usableMinutes).toBe(180);
    expect(inside.minutesRemaining).toBe(60);
  });

  it('is zero remaining the instant the window closes', () => {
    const atClose = clipToGates(
      pacific(TODAY, 11),
      pacific(TODAY, 14),
      ctx({ isToday: true, nowMs: pacific(TODAY, 14) }),
    );
    expect(atClose.minutesRemaining).toBe(0);
    expect(atClose.usableMinutes).toBe(180);
  });
});

/* =========================================================================
 * The swell window
 * ======================================================================= */

const WINDOW = { ceilingFt: 3.0, minimumFt: 1.0 };
const HAZARD_ONLY = { ceilingFt: 3.0, minimumFt: null };

describe('readSwell', () => {
  it('reads a value inside the window as inside it', () => {
    expect(readSwell(2.0, 0, WINDOW)).toEqual({ known: true, ft: 2.0, side: 'inside' });
  });

  it('is not over at exactly the ceiling, nor under at exactly the minimum', () => {
    expect(readSwell(3.0, 0, WINDOW)).toMatchObject({ side: 'inside' });
    expect(readSwell(1.0, 0, WINDOW)).toMatchObject({ side: 'inside' });
    expect(readSwell(3.01, 0, WINDOW)).toMatchObject({ side: 'over' });
    expect(readSwell(0.99, 0, WINDOW)).toMatchObject({ side: 'under' });
  });

  it('never reads under with no minimum declared, however small the reading', () => {
    // Tidepool's gate. Swell is a hazard on a reef, not something to ride.
    expect(readSwell(0.1, 0, HAZARD_ONLY)).toEqual({ known: true, ft: 0.1, side: 'inside' });
  });

  it('is unknown with no reading, and says that is why', () => {
    expect(readSwell(null, 0, WINDOW)).toEqual({
      known: false,
      ft: null,
      why: 'no-reading',
      daysFromToday: 0,
    });
  });

  it('covers days 0 through 4 and no further', () => {
    // Day 0 is today, so a 5-day horizon covers days 0 through 4. On a 7-day
    // grid the last two columns are always unknown, which is the honest answer.
    for (let d = 0; d < SWELL_HORIZON_DAYS; d++) {
      expect(readSwell(2.0, d, WINDOW).known, `day ${d}`).toBe(true);
    }
    expect(readSwell(2.0, SWELL_HORIZON_DAYS, WINDOW)).toMatchObject({
      known: false,
      why: 'past-horizon',
    });
  });

  it('is unknown for a day in the past, not a reading about it', () => {
    expect(readSwell(2.0, -1, WINDOW)).toMatchObject({ known: false, why: 'past-horizon' });
  });

  it('refuses NaN, which would fall straight through the gate', () => {
    // NaN compares false against `> ceiling` AND against `< minimum`, so it would
    // pass through the middle and read as a clean pass.
    expect(() => readSwell(NaN, 0, WINDOW)).toThrow(/finite number or null/);
  });

  it('refuses a non-finite limit rather than guessing one', () => {
    expect(() => readSwell(2.0, 0, { ceilingFt: NaN, minimumFt: 1.0 })).toThrow(/finite/);
    expect(() => readSwell(2.0, 0, { ceilingFt: 3.0, minimumFt: NaN })).toThrow(/finite/);
  });

  it('refuses a window where the minimum is not below the ceiling', () => {
    // `veto` and `flat` are mutually exclusive only while it is, and the states
    // are ordered on that being true.
    expect(() => readSwell(2.0, 0, { ceilingFt: 1.0, minimumFt: 3.0 })).toThrow(/inverted/);
    expect(() => readSwell(2.0, 0, { ceilingFt: 1.0, minimumFt: 1.0 })).toThrow(/empty|inverted/);
  });
});

/* =========================================================================
 * Precedence
 * ======================================================================= */

const known = (ft: number, side: 'over' | 'under' | 'inside'): SwellReading => ({
  known: true,
  ft,
  side,
});
const unknown = (why: 'no-reading' | 'past-horizon' = 'no-reading'): SwellReading => ({
  known: false,
  ft: null,
  why,
  daysFromToday: 0,
});

const verdict = (over: Partial<Parameters<typeof gateVerdict>[0]>) =>
  gateVerdict({
    decisiveMinutes: 120,
    gateBlocked: false,
    swell: known(2.0, 'inside'),
    minimumMinutes: MIN_USABLE_MINUTES,
    ...over,
  });

describe('gateVerdict', () => {
  it('is go when everything clears', () => {
    expect(verdict({})).toBe('go');
  });

  it('closed beats dark: a shut gate is decisive whatever the light', () => {
    expect(verdict({ decisiveMinutes: 0, gateBlocked: true })).toBe('closed');
    expect(verdict({ decisiveMinutes: 0, gateBlocked: false })).toBe('dark');
  });

  it('dark beats veto: a night window is a settled no without consulting the swell', () => {
    expect(verdict({ decisiveMinutes: 0, swell: known(9.0, 'over') })).toBe('dark');
  });

  it('veto beats brief: there is no point qualifying a no with how short it was', () => {
    expect(verdict({ decisiveMinutes: 20, swell: known(9.0, 'over') })).toBe('veto');
  });

  it('flat beats brief, on the same terms', () => {
    expect(verdict({ decisiveMinutes: 20, swell: known(0.4, 'under') })).toBe('flat');
  });

  it('brief beats swell-tbd: a 20-minute window is a settled fact about the tide', () => {
    expect(verdict({ decisiveMinutes: 20, swell: unknown() })).toBe('brief');
  });

  it('swell-tbd beats go, which is the repo-wide invariant', () => {
    // An unknown may never render as a pass. Everything else about this day
    // clears; the reading does not exist.
    expect(verdict({ swell: unknown() })).toBe('swell-tbd');
    expect(verdict({ swell: unknown('past-horizon') })).toBe('swell-tbd');
  });

  it('is brief exactly below the minimum and go exactly at it', () => {
    expect(verdict({ decisiveMinutes: MIN_USABLE_MINUTES })).toBe('go');
    expect(verdict({ decisiveMinutes: MIN_USABLE_MINUTES - 0.001 })).toBe('brief');
  });

  it('is dark at zero minutes and brief just above it', () => {
    expect(verdict({ decisiveMinutes: 0 })).toBe('dark');
    expect(verdict({ decisiveMinutes: 0.5 })).toBe('brief');
  });

  it('does not claim the gate shut a window that still has minutes in it', () => {
    // gateBlocked can only be the binding constraint once nothing is left.
    expect(verdict({ decisiveMinutes: 120, gateBlocked: true })).toBe('go');
  });
});

/* =========================================================================
 * The sentences the two occupants share
 * ======================================================================= */

describe('the shared sentences', () => {
  const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE)!;

  it('names the operator and its hours', () => {
    const reason = gateClosedReason(gate, ZONE, 'The tide drops below the floor', 'the window falls');
    expect(reason).toMatch(/outside gate hours/);
    expect(reason).toMatch(/9:00/);
    expect(reason).toMatch(/^The tide drops below the floor, but the window falls/);
  });

  it('names a published annual closure instead of the hours', () => {
    const xmas: LocalDate = { year: 2026, month: 12, day: 25 };
    const shut = gateWindowFor('cabrillo-tidepools', xmas, ZONE)!;
    expect(gateClosedReason(shut, ZONE, 'The tide is in the band', 'every session falls')).toMatch(
      /Christmas Day/,
    );
  });

  it('says what is LEFT on today and where the window FELL on any other day', () => {
    expect(darkReason(true, 'The tide is low enough', 'x', 'y')).toBe(
      'The tide is low enough, but there is no daylight left today while it is.',
    );
    expect(darkReason(false, 'x', 'The tide is in the band', 'every session falls')).toBe(
      'The tide is in the band, but every session falls outside daylight.',
    );
  });

  it('says the ceiling is uncalibrated, wherever it drives a verdict', () => {
    expect(swellVetoReason(4.2, 3.0)).toMatch(/4\.2 ft against an uncalibrated ceiling of 3\.0 ft/);
    expect(swellVetoReason(4.2, 3.0)).toMatch(/Called off/);
  });

  it('does not word flat as a refusal', () => {
    // `veto` is "do not go" and `flat` is "there is nothing there". A reader who
    // reads the two the same way treats a flat day as a dangerous one.
    const flat = swellFlatReason(0.4, 1.0, 'The tide works');
    expect(flat).toMatch(/nothing to ride/);
    expect(flat).not.toMatch(/[Cc]alled off/);
    expect(flat).not.toMatch(/[Vv]eto/);
  });

  it('names what the unknown is NOT, and the two activities name different things', () => {
    expect(swellUnknownReason(unknown(), 'calm')).toMatch(/unknown rather than calm/);
    expect(swellUnknownReason(unknown(), 'flat')).toMatch(/unknown rather than flat/);
  });

  it('says how far out a past-horizon day is, and that there is no forecast', () => {
    const reason = swellUnknownReason(
      { known: false, ft: null, why: 'past-horizon', daysFromToday: 6 },
      'calm',
    );
    expect(reason).toMatch(/6 days out/);
    expect(reason).toMatch(/stands in for 5/);
    expect(reason).toMatch(/no swell forecast in this stack/);
  });

  it('refuses to explain a reading that is not unknown', () => {
    expect(() => swellUnknownReason(known(2.0, 'inside'), 'calm')).toThrow(/known reading/);
  });
});

/* =========================================================================
 * Preconditions
 * ======================================================================= */

describe('assertSeriesCoversDay', () => {
  const covering = seriesFromTurns(TODAY, [
    { hour: 12, ft: 4.5, dayOffset: -1 },
    { hour: 13, ft: -1.0 },
    { hour: 12, ft: 4.5, dayOffset: 1 },
  ]);

  it('passes a series that covers the whole local day', () => {
    expect(() =>
      assertSeriesCoversDay('who', covering, TODAY, ZONE, DAY_START, DAY_END),
    ).not.toThrow();
  });

  it('throws rather than clamping a short series', () => {
    // Clamping would silently report every evening window as closing when the
    // payload happened to stop, and the number would look ordinary.
    const short = seriesFromTurns(TODAY, [
      { hour: 10, ft: 4.0 },
      { hour: 16, ft: -1.0 },
      { hour: 22, ft: 4.0 },
    ]);
    expect(() => assertSeriesCoversDay('who', short, TODAY, ZONE, DAY_START, DAY_END)).toThrow(
      /does not cover/,
    );
  });

  it('throws on an empty series, naming the caller', () => {
    const empty = { ...covering, samples: [] };
    expect(() => assertSeriesCoversDay('evaluateWindow', empty, TODAY, ZONE, DAY_START, DAY_END))
      .toThrow(/evaluateWindow: the series has no samples/);
  });
});
