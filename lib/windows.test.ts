import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  countUsable,
  evaluateWindow,
  FLOOD_SIDE_TRIM,
  MIN_WINDOW_MINUTES,
  STATE_PRESENTATION,
  SWELL_HORIZON_DAYS,
  WINDOW_STATES,
  type WindowInput,
  type WindowState,
} from './windows';
import { crossings, parseCoopsSeries, type CoopsRequestContract, type TideSeries } from './tide';
import { utcMsFromZoned, type LocalDate } from './time';

const ZONE = 'America/Los_Angeles';

/** La Jolla Shores. Sunrise 05:59:27, sunset 19:51:17 PDT on 2026-07-27. */
const LAT = 32.8669;
const LON = -117.2571;

const CONTRACT: CoopsRequestContract = {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
};

/* ---------------------------------------------------------------------------
 * A tide builder, so each state can be produced deliberately.
 *
 * Extrema are given explicitly and the curve between consecutive ones is a half
 * cosine, which has zero slope at both ends. That means the turns land exactly
 * where they were asked for -- and it is roughly the shape of a real tide, so the
 * flood and ebb rates near the floor are realistic rather than linear.
 * ------------------------------------------------------------------------- */

interface Turn {
  /** Pacific wall clock, on `day` unless `dayOffset` says otherwise. */
  hour: number;
  minute?: number;
  ft: number;
  dayOffset?: number;
}

function seriesFromTurns(day: LocalDate, turns: Turn[]): TideSeries {
  const at = (t: Turn) =>
    utcMsFromZoned(
      { ...day, day: day.day + (t.dayOffset ?? 0), hour: t.hour, minute: t.minute ?? 0 },
      ZONE,
    );

  const points = turns.map((t) => ({ tMs: at(t), ft: t.ft })).sort((a, b) => a.tMs - b.tMs);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const STEP = 6 * 60_000;
  const samples: { tMs: number; ft: number }[] = [];

  for (let tMs = first.tMs; tMs <= last.tMs; tMs += STEP) {
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.tMs <= tMs) i++;
    const a = points[i]!;
    const b = points[i + 1]!;
    const u = (tMs - a.tMs) / (b.tMs - a.tMs);
    const eased = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
    samples.push({ tMs, ft: Number((a.ft + (b.ft - a.ft) * eased).toFixed(3)) });
  }

  return {
    stationId: 'SYNTHETIC',
    datum: 'MLLW',
    units: 'ft',
    timeZone: 'UTC',
    samples,
    uniformStepMs: STEP,
  };
}

const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };
const pacific = (day: LocalDate, hour: number, minute = 0) =>
  utcMsFromZoned({ ...day, hour, minute }, ZONE);

/**
 * findExtrema recovers a turn to sub-sample precision, but the builder quantises
 * heights to three decimals exactly as CO-OPS does, so the recovered turn sits a
 * little off the requested instant -- most at the flattest turns, for the reason
 * lib/tide.ts documents. 90 s matches the tolerance the tide suite establishes
 * against NOAA's own hilo product.
 */
const expectNearMinute = (actualMs: number, expectedMs: number, seconds = 90) =>
  expect(
    Math.abs(actualMs - expectedMs) / 1000,
    `${new Date(actualMs).toISOString()} vs expected ${new Date(expectedMs).toISOString()}`,
  ).toBeLessThanOrEqual(seconds);

/**
 * Assert WHICH low was selected, rather than exactly where its turn landed.
 *
 * Used where the point of the test is the selection rule. Some of the builder's
 * turns have deliberately lopsided spans -- a fourteen-hour ebb into a
 * five-hour flood -- and a parabola fitted to a curve that asymmetric puts its
 * vertex a couple of minutes toward the flatter side. That is a property of the
 * synthetic curve, not of the selection being tested, so these assertions ask
 * only that the chosen low is unambiguously the intended one of the two.
 */
const expectPickedTurn = (actualMs: number, intendedMs: number, alternativeMs: number) => {
  const toIntended = Math.abs(actualMs - intendedMs);
  const toAlternative = Math.abs(actualMs - alternativeMs);
  expect(
    toIntended,
    `${new Date(actualMs).toISOString()} should be the turn near ` +
      `${new Date(intendedMs).toISOString()}, not ${new Date(alternativeMs).toISOString()}`,
  ).toBeLessThan(toAlternative);
  // And still close enough that it is that turn rather than some third one.
  expect(toIntended / 60_000).toBeLessThan(10);
};

/**
 * A mixed-semidiurnal day shaped like the corridor's: a big morning ebb to a
 * deep midday low, then a shallow second low in the evening. The deep low sits
 * at 13:00, comfortably inside daylight.
 */
function dayWithMiddayLow(lowFt: number): TideSeries {
  return seriesFromTurns(TODAY, [
    { hour: 12, ft: 4.5, dayOffset: -1 },
    { hour: 19, ft: 1.2, dayOffset: -1 },
    { hour: 6, minute: 30, ft: 5.2 },
    { hour: 13, ft: lowFt },
    { hour: 19, minute: 30, ft: 3.4 },
    { hour: 23, minute: 30, ft: 2.1 },
    { hour: 6, ft: 5.0, dayOffset: 1 },
    { hour: 13, ft: lowFt, dayOffset: 1 },
    { hour: 20, ft: 3.4, dayOffset: 1 },
    { hour: 1, ft: 2.0, dayOffset: 2 },
    { hour: 7, ft: 5.1, dayOffset: 2 },
  ]);
}

const baseInput = (over: Partial<WindowInput> = {}): WindowInput => ({
  series: dayWithMiddayLow(-1.6),
  date: TODAY,
  floorFt: -0.5,
  swellCeilingFt: 3.0,
  currentSwellFt: 2.0,
  nowMs: pacific(TODAY, 8, 0),
  lat: LAT,
  lon: LON,
  timeZone: ZONE,
  ...over,
});

/* =========================================================================
 * Constants are the documented ones
 * ======================================================================= */

describe('constants', () => {
  it('are the values the design specifies', () => {
    expect(MIN_WINDOW_MINUTES).toBe(45);
    expect(FLOOD_SIDE_TRIM).toBe(0.6);
    expect(SWELL_HORIZON_DAYS).toBe(5);
  });

  it('has presentation for all six states, and only those six', () => {
    expect(WINDOW_STATES).toHaveLength(6);
    expect(new Set(WINDOW_STATES).size).toBe(6);
    for (const state of WINDOW_STATES) {
      const p = STATE_PRESENTATION[state];
      expect(p, `presentation for ${state}`).toBeDefined();
      // Colour is never the only channel: every state carries a glyph too.
      expect(p.glyph.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.spoken.length).toBeGreaterThan(0);
    }
  });

  it('counts only `go` as usable', () => {
    const usable = WINDOW_STATES.filter((s) => STATE_PRESENTATION[s].usable);
    expect(usable).toEqual(['go']);
  });
});

/* =========================================================================
 * Every state
 * ======================================================================= */

describe('state: go', () => {
  const result = evaluateWindow(baseInput());

  it('is go for a deep midday low with swell under the ceiling', () => {
    expect(result.state).toBe('go');
  });

  it('reports the low, the next high and a window over the minimum', () => {
    expect(result.lowFt).toBeCloseTo(-1.6, 2);
    expectNearMinute(result.lowMs, pacific(TODAY, 13, 0));
    expectNearMinute(result.nextHighMs!, pacific(TODAY, 19, 30));
    expect(result.nextHighFt).toBeCloseTo(3.4, 2);
    expect(result.usableMinutes).toBeGreaterThan(MIN_WINDOW_MINUTES);
  });

  it('counts minutes remaining from now, because the day is today', () => {
    expect(result.isToday).toBe(true);
    expect(result.minutesRemaining).not.toBeNull();
  });
});

describe('state: above-floor', () => {
  it('is above-floor when the best low never reaches the floor', () => {
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(0.4), floorFt: -0.5 }));
    expect(result.state).toBe('above-floor');
    expect(result.usableMinutes).toBe(0);
    expect(result.reason).toMatch(/does not get under/);
  });

  it('treats a low exactly at the floor as above it, since an instant is not a window', () => {
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(-0.5), floorFt: -0.5 }));
    expect(result.state).toBe('above-floor');
  });

  it('does not invent a window for a low that stays above the floor', () => {
    // The regression this guards: taking the nearest floor crossings around a
    // low that never reaches the floor picks up the PREVIOUS low's crossings,
    // spanning the intervening high and yielding a phantom ten-hour window.
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(0.4), floorFt: -0.5 }));
    expect(result.windowEndMs - result.windowStartMs).toBe(0);
  });
});

describe('state: dark', () => {
  it('is dark when the only sub-floor low is before sunrise', () => {
    const series = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 3, ft: -1.6 }, // 03:00, well before the 05:59 sunrise
      { hour: 9, minute: 30, ft: 5.0 },
      { hour: 16, ft: 1.9 }, // shallow evening low, above the floor
      { hour: 21, ft: 4.2 },
      { hour: 3, ft: -1.4, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 1, 0) }));
    expect(result.state).toBe('dark');
    expectNearMinute(result.lowMs, pacific(TODAY, 3, 0));
    expect(result.usableMinutes).toBe(0);
  });

  it('is dark when the only sub-floor low is after sunset', () => {
    const series = seriesFromTurns(TODAY, [
      { hour: 12, ft: 4.0, dayOffset: -1 },
      { hour: 4, ft: 1.9 }, // shallow, above floor
      { hour: 19, ft: 5.0 }, // late high, so the ebb crosses the floor after dark
      { hour: 23, minute: 30, ft: -1.6 }, // well after the 19:51 sunset
      { hour: 5, ft: 4.6, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 8, 0) }));
    expect(result.state).toBe('dark');
    expectNearMinute(result.lowMs, pacific(TODAY, 23, 30));
  });

  it("is dark once today's windows have all closed, even in broad daylight", () => {
    // 17:00, with the day's deep low at 13:00. The window shut before now, so
    // there is no daylight left while the tide is low -- which is what `dark`
    // means here: the window and the AVAILABLE daylight do not overlap. On a
    // future day "available" is the whole day, which is the ordinary reading.
    const result = evaluateWindow(baseInput({ nowMs: pacific(TODAY, 18, 30) }));
    expect(result.state).toBe('dark');
    expect(result.minutesRemaining).toBe(0);
    expect(result.usableMinutes).toBeGreaterThan(0); // the window existed, it is just over
    expect(result.reason).toMatch(/no daylight left today/);
  });
});

describe('state: veto', () => {
  it('is veto when a known swell reading is over the ceiling', () => {
    const result = evaluateWindow(baseInput({ currentSwellFt: 4.2, swellCeilingFt: 3.0 }));
    expect(result.state).toBe('veto');
    expect(result.reason).toMatch(/4\.2 ft against an uncalibrated ceiling of 3\.0 ft/);
  });

  it('is not veto exactly at the ceiling', () => {
    const result = evaluateWindow(baseInput({ currentSwellFt: 3.0, swellCeilingFt: 3.0 }));
    expect(result.state).toBe('go');
  });
});

describe('state: brief', () => {
  it('is brief when daylight clips the window under the minimum', () => {
    // Low at 05:15, sunrise 05:59:27. The ebb side is entirely in the dark and
    // only part of the trimmed flood side survives.
    const series = seriesFromTurns(TODAY, [
      { hour: 20, ft: 4.0, dayOffset: -1 },
      { hour: 5, ft: -1.5 },
      { hour: 14, ft: 4.8 }, // slow flood, so 0.6 of it reaches past sunrise
      { hour: 19, ft: 1.9 },
      { hour: 23, ft: 4.0 },
      { hour: 5, minute: 30, ft: -1.5, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 4, 0) }));
    expect(result.state).toBe('brief');
    expect(result.minutesRemaining!).toBeLessThan(MIN_WINDOW_MINUTES);
    expect(result.minutesRemaining!).toBeGreaterThan(0);
    expect(result.reason).toMatch(/under the 45 min minimum/);
  });

  it('is brief when the low barely dips below the floor', () => {
    // Floor -0.5, low -0.56. The tide is under the floor for only a few minutes
    // regardless of the light.
    const result = evaluateWindow(
      baseInput({ series: dayWithMiddayLow(-0.56), floorFt: -0.5, nowMs: pacific(TODAY, 8, 0) }),
    );
    expect(result.state).toBe('brief');
    expect(result.minutesRemaining!).toBeLessThan(MIN_WINDOW_MINUTES);
  });
});

describe('state: swell-tbd', () => {
  it('is swell-tbd when the buoy is not delivering', () => {
    const result = evaluateWindow(baseInput({ currentSwellFt: null }));
    expect(result.state).toBe('swell-tbd');
    expect(result.swellKnown).toBe(false);
    expect(result.swellFt).toBeNull();
    expect(result.reason).toMatch(/unknown rather than calm/);
  });

  it('is swell-tbd past the horizon, however good the reading is now', () => {
    // Day 5 of a 5-day horizon: days 0 through 4 are covered, so this is the
    // first day the current reading may not stand in for.
    const fifthDay = { year: 2026, month: 8, day: 1 };
    const series = seriesFromTurns(fifthDay, [
      { hour: 12, ft: 4.5, dayOffset: -1 },
      { hour: 6, minute: 30, ft: 5.2 },
      { hour: 13, ft: -1.6 },
      { hour: 20, ft: 3.4 },
      { hour: 6, ft: 5.0, dayOffset: 1 },
    ]);
    const result = evaluateWindow(
      baseInput({ series, date: fifthDay, nowMs: pacific(TODAY, 8, 0), currentSwellFt: 1.0 }),
    );
    expect(result.daysFromToday).toBe(5);
    expect(result.state).toBe('swell-tbd');
    expect(result.swellKnown).toBe(false);
    expect(result.reason).toMatch(/no swell forecast in this stack/);
  });

  it('is still go on the last day inside the horizon', () => {
    const fourthDay = { year: 2026, month: 7, day: 31 };
    const series = seriesFromTurns(fourthDay, [
      { hour: 12, ft: 4.5, dayOffset: -1 },
      { hour: 6, minute: 30, ft: 5.2 },
      { hour: 13, ft: -1.6 },
      { hour: 20, ft: 3.4 },
      { hour: 6, ft: 5.0, dayOffset: 1 },
    ]);
    const result = evaluateWindow(
      baseInput({ series, date: fourthDay, nowMs: pacific(TODAY, 8, 0), currentSwellFt: 1.0 }),
    );
    expect(result.daysFromToday).toBe(4);
    expect(result.state).toBe('go');
    expect(result.swellKnown).toBe(true);
  });

  it('never reports an unknown swell as a pass', () => {
    // The whole point of the state. Perfect tide, perfect light, no reading.
    const result = evaluateWindow(baseInput({ currentSwellFt: null }));
    expect(result.usableMinutes).toBeGreaterThan(MIN_WINDOW_MINUTES);
    expect(STATE_PRESENTATION[result.state].usable).toBe(false);
  });
});

/* =========================================================================
 * Precedence
 * ======================================================================= */

describe('state precedence', () => {
  const nightLowAboveFloor = seriesFromTurns(TODAY, [
    { hour: 18, ft: 4.0, dayOffset: -1 },
    { hour: 3, ft: 0.4 }, // above the floor AND in the dark
    { hour: 9, minute: 30, ft: 5.0 },
    { hour: 16, ft: 1.9 },
    { hour: 22, ft: 4.2 },
    { hour: 3, ft: 0.4, dayOffset: 1 },
  ]);

  it('above-floor beats dark: no floor crossing means there is nothing to be dark about', () => {
    const result = evaluateWindow(
      baseInput({ series: nightLowAboveFloor, nowMs: pacific(TODAY, 1, 0) }),
    );
    expect(result.state).toBe('above-floor');
  });

  it('above-floor beats veto', () => {
    const result = evaluateWindow(
      baseInput({ series: dayWithMiddayLow(0.4), currentSwellFt: 9.0 }),
    );
    expect(result.state).toBe('above-floor');
  });

  it('dark beats veto: a night low is a settled no without consulting the swell', () => {
    const series = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 3, ft: -1.6 },
      { hour: 9, minute: 30, ft: 5.0 },
      { hour: 16, ft: 1.9 },
      { hour: 22, ft: 4.2 },
      { hour: 3, ft: -1.4, dayOffset: 1 },
    ]);
    const result = evaluateWindow(
      baseInput({ series, nowMs: pacific(TODAY, 1, 0), currentSwellFt: 9.0 }),
    );
    expect(result.state).toBe('dark');
  });

  it('veto beats brief: there is no point qualifying a no with how short it was', () => {
    const result = evaluateWindow(
      baseInput({ series: dayWithMiddayLow(-0.56), floorFt: -0.5, currentSwellFt: 9.0 }),
    );
    expect(result.state).toBe('veto');
  });

  it('brief beats swell-tbd: a 20-minute window is a settled fact about the tide', () => {
    const result = evaluateWindow(
      baseInput({ series: dayWithMiddayLow(-0.56), floorFt: -0.5, currentSwellFt: null }),
    );
    expect(result.state).toBe('brief');
  });

  it('swell-tbd beats go', () => {
    expect(evaluateWindow(baseInput({ currentSwellFt: null })).state).toBe('swell-tbd');
    expect(evaluateWindow(baseInput({ currentSwellFt: 2.0 })).state).toBe('go');
  });
});

/* =========================================================================
 * Today, partway through
 * ======================================================================= */

describe('today, partway through the window', () => {
  const series = dayWithMiddayLow(-1.6);
  const full = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 8, 0) }));

  it('counts minutes remaining from now, not from the window start', () => {
    // now inside the window: after it opened, before it closed.
    const midway = evaluateWindow(
      baseInput({ series, nowMs: full.usableStartMs + 30 * 60_000 }),
    );
    expect(midway.state).toBe('go');
    expect(midway.usableMinutes).toBeCloseTo(full.usableMinutes, 6);
    // Exactly 30 minutes have been consumed.
    expect(midway.minutesRemaining).toBeCloseTo(full.usableMinutes - 30, 6);
  });

  it('reports the whole window before it opens, not the time until it shuts', () => {
    // An hour before the window opens, "remaining" is the window itself. The
    // naive reading -- time from now until the window closes -- would be an hour
    // longer and would overstate what is actually workable.
    const nowMs = full.usableStartMs - 60 * 60_000;
    const early = evaluateWindow(baseInput({ series, nowMs }));
    expect(early.minutesRemaining).toBeCloseTo(early.usableMinutes, 6);
    const naive = (early.usableEndMs - nowMs) / 60_000;
    expect(early.minutesRemaining!).toBeCloseTo(naive - 60, 6);
  });

  it('degrades go to brief as the window runs down past the 45-minute mark', () => {
    const at = (offsetMinutes: number) =>
      evaluateWindow(baseInput({ series, nowMs: full.usableEndMs - offsetMinutes * 60_000 }));

    expect(at(60).state).toBe('go');
    expect(at(46).state).toBe('go');
    expect(at(45).state).toBe('go'); // exactly at the minimum still counts
    expect(at(44).state).toBe('brief');
    expect(at(5).state).toBe('brief');
  });

  it('goes dark the instant the window closes', () => {
    const atClose = evaluateWindow(baseInput({ series, nowMs: full.usableEndMs }));
    expect(atClose.minutesRemaining).toBe(0);
    expect(atClose.state).toBe('dark');
  });

  it('holds usableMinutes steady while minutesRemaining falls', () => {
    // The distinction the UI needs to say "1 h 36 min window, 42 min left".
    const early = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 8, 0) }));
    const late = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 14, 0) }));
    expect(late.usableMinutes).toBeCloseTo(early.usableMinutes, 6);
    expect(late.minutesRemaining!).toBeLessThan(early.minutesRemaining!);
  });

  it('picks the low whose window is still open, not the following one', () => {
    // Two sub-floor lows in one day, now sitting inside the first window. The
    // "next low from current time" is strictly the second, but reporting it would
    // hide the time actually left on the reef right now.
    const twoLows = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 8, ft: -1.2 },
      { hour: 13, ft: 4.4 },
      { hour: 18, minute: 30, ft: -1.0 },
      { hour: 23, minute: 30, ft: 4.0 },
      { hour: 8, ft: -1.2, dayOffset: 1 },
    ]);
    const insideFirst = evaluateWindow(baseInput({ series: twoLows, nowMs: pacific(TODAY, 8, 30) }));
    expectPickedTurn(insideFirst.lowMs, pacific(TODAY, 8, 0), pacific(TODAY, 18, 30));
    expect(insideFirst.minutesRemaining!).toBeGreaterThan(0);

    // Once the first window has closed, it moves on to the second.
    const afterFirst = evaluateWindow(baseInput({ series: twoLows, nowMs: pacific(TODAY, 12, 0) }));
    expectPickedTurn(afterFirst.lowMs, pacific(TODAY, 18, 30), pacific(TODAY, 8, 0));
  });

  it('leaves minutesRemaining null on days that are not today', () => {
    const tomorrow = { year: 2026, month: 7, day: 28 };
    const result = evaluateWindow(baseInput({ series, date: tomorrow }));
    expect(result.isToday).toBe(false);
    expect(result.daysFromToday).toBe(1);
    expect(result.minutesRemaining).toBeNull();
  });
});

/* =========================================================================
 * Window geometry
 * ======================================================================= */

describe('window geometry', () => {
  const input = baseInput();
  const result = evaluateWindow(input);

  it('runs the full ebb side and trims the flood side to 0.6', () => {
    const floorCrossings = crossings(input.series, input.floorFt);
    const falling = floorCrossings.find((c) => c.direction === 'falling')!;
    const rising = floorCrossings.find((c) => c.direction === 'rising' && c.tMs > result.lowMs)!;

    // Ebb side: opens exactly at the falling crossing, no trim.
    expect(result.windowStartMs).toBe(falling.tMs);

    // Flood side: 0.6 of the way back up to the floor.
    const floodSpan = rising.tMs - result.lowMs;
    expect(result.windowEndMs).toBe(Math.round(result.lowMs + FLOOD_SIDE_TRIM * floodSpan));

    // Which makes the window shorter than the raw sub-floor interval.
    expect(result.windowEndMs).toBeLessThan(rising.tMs);
  });

  it('is asymmetric about the low, with less time after it than before', () => {
    const before = result.lowMs - result.windowStartMs;
    const after = result.windowEndMs - result.lowMs;
    expect(after).toBeLessThan(before);

    // The ratio of after to before is NOT the trim factor. The ebb and flood
    // spans to the floor differ in their own right, because the highs either side
    // of the low differ. The trim applies to the flood span only.
    const floorCrossings = crossings(input.series, input.floorFt);
    const rising = floorCrossings.find((c) => c.direction === 'rising' && c.tMs > result.lowMs)!;
    expect(after / (rising.tMs - result.lowMs)).toBeCloseTo(FLOOD_SIDE_TRIM, 3);
  });

  it('clips the usable window to daylight without moving the raw window', () => {
    expect(result.usableStartMs).toBeGreaterThanOrEqual(result.windowStartMs);
    expect(result.usableEndMs).toBeLessThanOrEqual(result.windowEndMs);
    expect(result.usableStartMs).toBeGreaterThanOrEqual(result.sunriseMs);
    expect(result.usableEndMs).toBeLessThanOrEqual(result.sunsetMs);
  });

  it('places sunrise and sunset where USNO puts them for the day', () => {
    // 05:59 and 19:51 PDT on 2026-07-27, from aa.usno.navy.mil.
    expect(result.sunriseMs).toBeGreaterThan(pacific(TODAY, 5, 58));
    expect(result.sunriseMs).toBeLessThan(pacific(TODAY, 6, 0));
    expect(result.sunsetMs).toBeGreaterThan(pacific(TODAY, 19, 50));
    expect(result.sunsetMs).toBeLessThan(pacific(TODAY, 19, 52));
  });
});

/* =========================================================================
 * Best daylight low, on days that are not today
 * ======================================================================= */

describe('best daylight low', () => {
  it('prefers the low with the most usable daylight over the deeper one', () => {
    // A deeper low at 04:00 in the dark, a shallower one at 14:00 in the light.
    // Both clear the floor. The daylight one is the useful answer.
    const series = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 4, ft: -2.2 },
      { hour: 9, ft: 4.6 },
      { hour: 14, ft: -1.1 },
      { hour: 20, minute: 30, ft: 3.8 },
      { hour: 4, ft: -2.0, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, date: TODAY, nowMs: pacific(TODAY, 3, 0) }));
    // Not today's rule: check the future-day rule explicitly.
    const future = evaluateWindow(
      baseInput({ series, date: TODAY, nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8) }),
    );
    expect(future.isToday).toBe(false);
    expectPickedTurn(future.lowMs, pacific(TODAY, 14, 0), pacific(TODAY, 4, 0));
    expect(future.lowFt).toBeCloseTo(-1.1, 2);
    // And today's rule, from 03:00, takes the next one instead.
    expectPickedTurn(result.lowMs, pacific(TODAY, 4, 0), pacific(TODAY, 14, 0));
  });

  it('falls back to the lowest low when none of them see daylight', () => {
    const series = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 3, ft: -1.2 },
      { hour: 17, ft: 4.6 }, // late high: the ebb crosses the floor after sunset
      { hour: 23, ft: -1.9 },
      { hour: 5, ft: 4.4, dayOffset: 1 },
    ]);
    const future = evaluateWindow(
      baseInput({ series, date: TODAY, nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8) }),
    );
    expect(future.state).toBe('dark');
    expect(future.lowFt).toBeCloseTo(-1.9, 2);
  });
});

/* =========================================================================
 * Refusals
 * ======================================================================= */

describe('refusals', () => {
  it('throws on a non-finite floor rather than guessing one', () => {
    expect(() => evaluateWindow(baseInput({ floorFt: NaN }))).toThrow(/floorFt must be a finite/);
    expect(() =>
      evaluateWindow(baseInput({ floorFt: null as unknown as number })),
    ).toThrow(/floorFt must be a finite/);
  });

  it('throws on a NaN swell, which would compare false and read as under the ceiling', () => {
    expect(() => evaluateWindow(baseInput({ currentSwellFt: NaN }))).toThrow(
      /finite number or null/,
    );
  });

  it('throws when the series does not cover the local day', () => {
    const shortSeries = seriesFromTurns(TODAY, [
      { hour: 10, ft: 4.0 },
      { hour: 16, ft: -1.0 },
      { hour: 22, ft: 4.0 },
    ]);
    expect(() => evaluateWindow(baseInput({ series: shortSeries }))).toThrow(/does not cover/);
  });
});

/* =========================================================================
 * Against the captured predictions
 * ======================================================================= */

describe('the real 27 July corridor tide', () => {
  const payload = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('./__fixtures__/coops-9410230-20260727-6min.json', import.meta.url)),
      'utf8',
    ),
  );
  const series = parseCoopsSeries(payload, CONTRACT);

  // spots.json floors, verbatim.
  const cases = [
    { slug: 'cabrillo-tidepools', floorFt: -0.2, lat: 32.669, lon: -117.245, expected: 'dark' },
    { slug: 'la-jolla-cove', floorFt: -0.4, lat: 32.85, lon: -117.272, expected: 'above-floor' },
    { slug: 'windansea', floorFt: -0.5, lat: 32.832, lon: -117.28, expected: 'above-floor' },
    { slug: 'la-jolla-shores', floorFt: -0.7, lat: 32.857, lon: -117.257, expected: 'above-floor' },
    { slug: 'sunset-cliffs', floorFt: -0.8, lat: 32.723, lon: -117.256, expected: 'above-floor' },
  ] as const;

  for (const c of cases) {
    it(`${c.slug} is ${c.expected} on 2026-07-27`, () => {
      const result = evaluateWindow({
        series,
        date: TODAY,
        floorFt: c.floorFt,
        swellCeilingFt: 3.0,
        currentSwellFt: 1.1, // NDBC 46254 WVHT that morning, 1.1 m
        nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8), // a past date, so not today
        lat: c.lat,
        lon: c.lon,
        timeZone: ZONE,
      });
      expect(result.state, result.reason).toBe(c.expected as WindowState);
    });
  }

  it("puts Cabrillo's only sub-floor low at 3:21 am, which is why it is dark not above-floor", () => {
    // The distinction the phantom-window bug erased. Cabrillo's floor of -0.2 ft
    // IS cleared that day -- by the 03:21 low at -0.324 ft -- so the honest answer
    // is that the workable window is in the dark, not that the reef never
    // surfaces. The afternoon low at 2.581 ft must not be selected just because
    // it happens to sit in daylight.
    const result = evaluateWindow({
      series,
      date: TODAY,
      floorFt: -0.2,
      swellCeilingFt: 3.0,
      currentSwellFt: 1.1,
      nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8),
      lat: 32.669,
      lon: -117.245,
      timeZone: ZONE,
    });
    expect(result.state).toBe('dark');
    expect(result.lowFt).toBeCloseTo(-0.324, 2);
    // 10:21Z is 03:21 PDT.
    expect(result.lowMs).toBeGreaterThan(pacific(TODAY, 3, 20));
    expect(result.lowMs).toBeLessThan(pacific(TODAY, 3, 23));
    expect(result.lowMs).toBeLessThan(result.sunriseMs);
  });

  it('no corridor tidepool spot has a usable window on 2026-07-27', () => {
    // Worth stating plainly: the day this was built, every one of the eight spots
    // was unusable. A grid that showed a green cell here would be wrong.
    const floors = [-0.2, -0.4, -0.5, -0.5, -0.6, -0.6, -0.7, -0.8];
    const states = floors.map(
      (floorFt) =>
        evaluateWindow({
          series,
          date: TODAY,
          floorFt,
          swellCeilingFt: 3.0,
          currentSwellFt: 1.1,
          nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8),
          lat: LAT,
          lon: LON,
          timeZone: ZONE,
        }).state,
    );
    expect(states.every((s) => !STATE_PRESENTATION[s].usable)).toBe(true);
    expect(countUsable(
      floors.map((floorFt) =>
        evaluateWindow({
          series,
          date: TODAY,
          floorFt,
          swellCeilingFt: 3.0,
          currentSwellFt: 1.1,
          nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8),
          lat: LAT,
          lon: LON,
          timeZone: ZONE,
        }),
      ),
    )).toBe(0);
  });
});
