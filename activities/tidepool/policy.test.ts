/*
 * Tidepool's PREDICATE and its JUDGEMENTS.
 *
 * What is NOT here any more, because #130 moved the code it tested into
 * core/window/ and the tests with it:
 *
 *   the daylight and gate clips, and `gateBlocked`      core/window/gates.test.ts
 *   the swell horizon, and the NaN refusal              core/window/gates.test.ts
 *   the gate states' precedence                         core/window/states.test.ts
 *   the maximal-run walk, and both documented bugs      core/window/solve.test.ts
 *   the tide builder                                    core/window/__testing__/
 *
 * What is here is what only tidepool can answer: the floor, the flood-side trim,
 * which low the day is about, and the sentences a reader is shown. Each of those
 * is exercised end to end through `evaluateWindow`, so the composition is tested
 * as well as the parts -- what is gone is the second copy of the parts.
 */
import { describe, expect, it } from 'vitest';

import {
  countUsable,
  evaluateWindow,
  FLOOD_SIDE_TRIM,
  lowLighting,
  MIN_WINDOW_MINUTES,
  SWELL_HORIZON_DAYS,
  type WindowInput,
} from './policy';
import { coreStatesIn, STATE_PRESENTATION, WINDOW_STATES, type WindowState } from './states';
import { CORE_STATES } from '../../core/window/states';
import { crossings, type TideSeries } from '../../core/feeds/coops-predictions';
import { gateWindowFor } from '../../core/spot/access';
import { utcMsFromZoned, type LocalDate } from '../../core/time';
import {
  expectNearMinute,
  expectPickedTurn,
  loadCoopsFixture,
  pacific,
  seriesFromTurns,
  ZONE,
} from '../../core/window/__testing__/series';

/** La Jolla Shores. Sunrise 05:59:27, sunset 19:51:17 PDT on 2026-07-27. */
const LAT = 32.8669;
const LON = -117.2571;

const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };

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
 * Constants and states
 * ======================================================================= */

describe('constants', () => {
  it('are the values the design specifies', () => {
    expect(MIN_WINDOW_MINUTES).toBe(45);
    expect(FLOOD_SIDE_TRIM).toBe(0.6);
    expect(SWELL_HORIZON_DAYS).toBe(5);
  });
});

describe('states', () => {
  it('has presentation for all seven states, and only those seven', () => {
    expect(WINDOW_STATES).toHaveLength(7);
    expect(new Set(WINDOW_STATES).size).toBe(7);
    expect(Object.keys(STATE_PRESENTATION)).toEqual([...WINDOW_STATES]);
  });

  it('carries no state its gates cannot emit', () => {
    // `flat` needs a swell MINIMUM and tidepool declares none: swell is a hazard
    // on a reef, not something to ride. A row for it would be a verdict this
    // activity can never reach.
    expect(WINDOW_STATES).not.toContain('flat');
    expect(Object.keys(STATE_PRESENTATION)).not.toContain('flat');
  });

  it('does not reorder the shared precedence while putting above-floor at the front', () => {
    expect(WINDOW_STATES[0]).toBe('above-floor');
    expect(coreStatesIn(WINDOW_STATES)).toEqual(CORE_STATES.filter((s) => s !== 'flat'));
  });

  it('counts only `go` as usable, and gives above-floor a glyph of its own', () => {
    expect(WINDOW_STATES.filter((s) => STATE_PRESENTATION[s].usable)).toEqual(['go']);
    expect(STATE_PRESENTATION['above-floor'].label).toBe('Covered');
    expect(STATE_PRESENTATION['above-floor'].glyph).not.toBe('▲');
    expect(STATE_PRESENTATION['above-floor'].glyph).not.toBe('▼');
  });
});

/* =========================================================================
 * Cell lighting
 * ======================================================================= */

describe('lowLighting', () => {
  it('is decided by the low against sunrise and sunset, not by the state', () => {
    // This is what a cell's background says, and it must stay an observation.
    // `dark` is a verdict about the whole window and can disagree: a low can be
    // in daylight while the usable part of its window is not.
    const midday = evaluateWindow(baseInput());
    expect(midday.state).toBe('go');
    expect(lowLighting(midday)).toBe('day');
  });

  it('reads only the low, sunrise and sunset', () => {
    const base = evaluateWindow(baseInput());
    const oneMinute = 60_000;
    const withLowAt = (lowMs: number) => ({ ...base, detail: { ...base.detail, lowMs } });

    expect(lowLighting(withLowAt(base.sunriseMs - oneMinute))).toBe('night');
    expect(lowLighting(withLowAt(base.sunriseMs))).toBe('day');
    expect(lowLighting(withLowAt(base.sunsetMs))).toBe('day');
    expect(lowLighting(withLowAt(base.sunsetMs + oneMinute))).toBe('night');
  });
});

/* =========================================================================
 * The floor predicate, and the state it emits
 * ======================================================================= */

describe('state: above-floor', () => {
  it('is above-floor when the best low never reaches the floor', () => {
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(0.4), floorFt: -0.5 }));
    expect(result.state).toBe('above-floor');
    expect(result.reason).toMatch(/does not get under/);
    expect(result.detail.reachesFloor).toBe(false);
  });

  it('treats a low exactly at the floor as above it, since an instant is not a window', () => {
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(-0.5), floorFt: -0.5 }));
    expect(result.state).toBe('above-floor');
  });

  it('reports no window at all, rather than a zero-length one at the low', () => {
    /*
     * What #130 changed about this state, and it is a real improvement rather
     * than a rename. `above-floor` used to carry a window whose start and end
     * were both the low's own instant, which trivially satisfied "ends after
     * now" and had to be excluded from the selection by hand. Absence is now
     * absent.
     */
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(0.4), floorFt: -0.5 }));
    expect(result.detail.window).toBeNull();
    expect(result.windows).toEqual([]);
  });

  it('outranks every gate: there was no window for one to shut', () => {
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    const nightAndAboveFloor = seriesFromTurns(TODAY, [
      { hour: 18, ft: 4.0, dayOffset: -1 },
      { hour: 3, ft: 0.4 }, // above the floor AND in the dark
      { hour: 9, minute: 30, ft: 5.0 },
      { hour: 16, ft: 1.9 },
      { hour: 22, ft: 4.2 },
      { hour: 3, ft: 0.4, dayOffset: 1 },
    ]);
    expect(
      evaluateWindow(
        baseInput({
          series: nightAndAboveFloor,
          nowMs: pacific(TODAY, 1, 0),
          gate,
          currentSwellFt: 9.0,
        }),
      ).state,
    ).toBe('above-floor');
  });
});

/* =========================================================================
 * The sentences, which are this activity's
 * ======================================================================= */

describe('the reason a reader is given', () => {
  it('names the floor and the low it missed it by', () => {
    const result = evaluateWindow(baseInput({ series: dayWithMiddayLow(0.4), floorFt: -0.5 }));
    expect(result.reason).toMatch(/only reaches 0\.4 ft/);
    expect(result.reason).toMatch(/The reef stays covered/);
  });

  it('says "the window", singular, wherever a gate shut it', () => {
    // Surf's equivalent says "every session". The two shapes are different and
    // the sentences say so.
    const nightLow = seriesFromTurns(TODAY, [
      { hour: 12, ft: 4.0, dayOffset: -1 },
      { hour: 4, ft: 1.9 },
      { hour: 19, ft: 5.0 },
      { hour: 23, minute: 30, ft: -1.6 },
      { hour: 5, ft: 4.6, dayOffset: 1 },
    ]);
    const future = evaluateWindow(
      baseInput({ series: nightLow, nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8) }),
    );
    expect(future.state).toBe('dark');
    expect(future.reason).toBe(
      'The tide drops below the floor, but the window falls outside daylight.',
    );
  });

  it('says the tide is "low enough" when today has simply run out of light', () => {
    const series = seriesFromTurns(TODAY, [
      { hour: 20, ft: 4.0, dayOffset: -1 },
      { hour: 5, ft: 2.0 },
      { hour: 10, ft: 4.4 },
      { hour: 16, ft: -1.6 },
      { hour: 23, minute: 30, ft: 4.2 },
      { hour: 5, ft: 2.0, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 21, 0) }));
    expect(result.state).toBe('dark');
    expect(result.reason).toMatch(/no daylight left today/);
  });

  it('calls an unknown swell unknown rather than calm', () => {
    // "calm" and not "flat": this activity reads swell as a hazard, so the
    // assumption a reader would otherwise make is that it is quiet.
    const result = evaluateWindow(baseInput({ currentSwellFt: null }));
    expect(result.state).toBe('swell-tbd');
    expect(result.reason).toMatch(/unknown rather than calm/);
    expect(result.swellKnown).toBe(false);
    expect(result.swellFt).toBeNull();
  });

  it('never reports an unknown swell as a pass', () => {
    // The whole point of the state. Perfect tide, perfect light, no reading.
    const result = evaluateWindow(baseInput({ currentSwellFt: null }));
    expect(result.detail.window!.usableMinutes).toBeGreaterThan(MIN_WINDOW_MINUTES);
    expect(STATE_PRESENTATION[result.state].usable).toBe(false);
  });

  it('counts the minutes the window has, in this activity’s words', () => {
    const brief = evaluateWindow(
      baseInput({ series: dayWithMiddayLow(-0.56), floorFt: -0.5 }),
    );
    expect(brief.state).toBe('brief');
    expect(brief.reason).toMatch(/Only \d+ min of usable window, under the 45 min minimum/);

    const go = evaluateWindow(baseInput());
    expect(go.state).toBe('go');
    expect(go.reason).toMatch(/min of daylight window with the tide under the floor/);
  });

  it('carries the series-clipped caveat as a disclosure and in the reason', () => {
    /*
     * A day still under the floor when the payload runs out, so the window's
     * length is a floor on the real one rather than the real one.
     *
     * The reason has to stand alone -- it is what a cell discloses -- and the
     * same caveat is data for anything that wants to render it separately, which
     * is what `disclosures` is for.
     */
    const clipped = evaluateWindow(
      baseInput({
        series: seriesFromTurns(TODAY, [
          { hour: 12, ft: 4.5, dayOffset: -1 },
          { hour: 6, minute: 30, ft: 5.2 },
          { hour: 13, ft: -1.6 },
          { hour: 23, ft: -0.9 },
          { hour: 0, ft: -1.2, dayOffset: 1 }, // still under the floor at the last sample
        ]),
        nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8),
      }),
    );
    expect(clipped.detail.window!.seriesClipped).toBe(true);
    expect(clipped.disclosures).toHaveLength(1);
    expect(clipped.disclosures[0]).toMatch(/past the end of the prediction series/);
    expect(clipped.reason).toContain(clipped.disclosures[0]!);
    expect(clipped.reason).not.toBe(clipped.disclosures[0]);
  });

  it('has an empty disclosure list on an ordinary day', () => {
    expect(evaluateWindow(baseInput()).disclosures).toEqual([]);
  });
});

/* =========================================================================
 * The flood-side trim, which stayed here
 * ======================================================================= */

describe('window geometry', () => {
  const input = baseInput();
  const result = evaluateWindow(input);
  const window = result.detail.window!;

  it('runs the full ebb side and trims the flood side to 0.6', () => {
    const floorCrossings = crossings(input.series, input.floorFt);
    const falling = floorCrossings.find((c) => c.direction === 'falling')!;
    const rising = floorCrossings.find(
      (c) => c.direction === 'rising' && c.tMs > result.detail.lowMs,
    )!;

    // Ebb side: opens exactly at the falling crossing, no trim.
    expect(window.startMs).toBe(falling.tMs);

    // Flood side: 0.6 of the way back up to the floor.
    const floodSpan = rising.tMs - result.detail.lowMs;
    expect(window.endMs).toBe(Math.round(result.detail.lowMs + FLOOD_SIDE_TRIM * floodSpan));

    // Which makes the window shorter than the raw sub-floor interval.
    expect(window.endMs).toBeLessThan(rising.tMs);
  });

  it('is asymmetric about the low, with less time after it than before', () => {
    const before = result.detail.lowMs - window.startMs;
    const after = window.endMs - result.detail.lowMs;
    expect(after).toBeLessThan(before);

    // The ratio of after to before is NOT the trim factor. The ebb and flood
    // spans to the floor differ in their own right, because the highs either side
    // of the low differ. The trim applies to the flood span only.
    const rising = crossings(input.series, input.floorFt).find(
      (c) => c.direction === 'rising' && c.tMs > result.detail.lowMs,
    )!;
    expect(after / (rising.tMs - result.detail.lowMs)).toBeCloseTo(FLOOD_SIDE_TRIM, 3);
  });

  it('reports the low and the next high', () => {
    expect(result.detail.lowFt).toBeCloseTo(-1.6, 2);
    expectNearMinute(result.detail.lowMs, pacific(TODAY, 13, 0));
    expectNearMinute(result.detail.nextHighMs!, pacific(TODAY, 19, 30));
    expect(result.detail.nextHighFt).toBeCloseTo(3.4, 2);
  });
});

/* =========================================================================
 * Which low the day is about -- this activity's anchor, one layer up from
 * the solver
 * ======================================================================= */

describe('the selection, on today', () => {
  const series = dayWithMiddayLow(-1.6);
  const full = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 8, 0) }));
  const fullWindow = full.detail.window!;

  it('degrades go to brief as the window runs down past the 45-minute mark', () => {
    const at = (offsetMinutes: number) =>
      evaluateWindow(baseInput({ series, nowMs: fullWindow.usableEndMs - offsetMinutes * 60_000 }));

    expect(at(60).state).toBe('go');
    expect(at(45).state).toBe('go'); // exactly at the minimum still counts
    expect(at(44).state).toBe('brief');
  });

  it('goes dark the instant the window closes', () => {
    const atClose = evaluateWindow(baseInput({ series, nowMs: fullWindow.usableEndMs }));
    expect(atClose.detail.window!.minutesRemaining).toBe(0);
    expect(atClose.state).toBe('dark');
  });

  it('moves on to the next low once a window has closed, even when that low is above the floor', () => {
    // 18:30. The deep 13:00 low is covered again and the next one -- 23:30, at
    // 2.1 ft -- is nowhere near the floor. Reporting the 13:00 low would answer a
    // question about this afternoon under a heading that says "today"; what the
    // reader has ahead of them is a low that never uncovers the reef, and saying
    // so is the point of `above-floor`.
    const result = evaluateWindow(baseInput({ nowMs: pacific(TODAY, 18, 30) }));
    expect(result.state).toBe('above-floor');
    expectPickedTurn(result.detail.lowMs, pacific(TODAY, 23, 30), pacific(TODAY, 13, 0));
    expect(result.detail.lowFt).toBeCloseTo(2.1, 1);
    expect(result.detail.reachesFloor).toBe(false);
    expect(result.reason).toMatch(/^The next low/);

    // ...and the day's OTHER window is still reported, because `windows` is the
    // day's list and `detail.window` is the one the verdict is about.
    expect(result.windows.length).toBeGreaterThan(0);
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
    const insideFirst = evaluateWindow(
      baseInput({ series: twoLows, nowMs: pacific(TODAY, 8, 30) }),
    );
    expectPickedTurn(insideFirst.detail.lowMs, pacific(TODAY, 8, 0), pacific(TODAY, 18, 30));
    expect(insideFirst.detail.window!.minutesRemaining!).toBeGreaterThan(0);
    // Two lows reach the floor, so the day carries two windows.
    expect(insideFirst.windows).toHaveLength(2);

    // Once the first window has closed, it moves on to the second.
    const afterFirst = evaluateWindow(baseInput({ series: twoLows, nowMs: pacific(TODAY, 12, 0) }));
    expectPickedTurn(afterFirst.detail.lowMs, pacific(TODAY, 18, 30), pacific(TODAY, 8, 0));
  });

  it("stands on the day's last low once there is no next one", () => {
    // 21:00, after a 16:00 low whose window shut in daylight. There is no later
    // low to report, so the one that has just gone stands and the now-clip says
    // what is true: nothing more is coming today. Picking the day's BEST low here
    // instead would report a window that closed this morning as though it were
    // still the news.
    const series = seriesFromTurns(TODAY, [
      { hour: 20, ft: 4.0, dayOffset: -1 },
      { hour: 5, ft: 2.0 },
      { hour: 10, ft: 4.4 },
      { hour: 16, ft: -1.6 },
      { hour: 23, minute: 30, ft: 4.2 },
      { hour: 5, ft: 2.0, dayOffset: 1 },
    ]);
    const result = evaluateWindow(baseInput({ series, nowMs: pacific(TODAY, 21, 0) }));
    expect(result.state).toBe('dark');
    expectPickedTurn(result.detail.lowMs, pacific(TODAY, 16, 0), pacific(TODAY, 5, 0));
    expect(result.detail.window!.minutesRemaining).toBe(0);
    // The window existed, it is just over.
    expect(result.detail.window!.usableMinutes).toBeGreaterThan(0);
  });

  it('leaves minutesRemaining null on days that are not today', () => {
    const tomorrow = { year: 2026, month: 7, day: 28 };
    const result = evaluateWindow(baseInput({ series, date: tomorrow }));
    expect(result.isToday).toBe(false);
    expect(result.daysFromToday).toBe(1);
    expect(result.detail.window!.minutesRemaining).toBeNull();
  });
});

describe('the selection, on any other day', () => {
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
    const future = evaluateWindow(
      baseInput({ series, date: TODAY, nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8) }),
    );
    expect(future.isToday).toBe(false);
    expectPickedTurn(future.detail.lowMs, pacific(TODAY, 14, 0), pacific(TODAY, 4, 0));
    expect(future.detail.lowFt).toBeCloseTo(-1.1, 2);

    // And today's rule, from 03:00, takes the next one instead. The two rules
    // genuinely differ, which is why neither belongs in the solver.
    const today = evaluateWindow(baseInput({ series, date: TODAY, nowMs: pacific(TODAY, 3, 0) }));
    expectPickedTurn(today.detail.lowMs, pacific(TODAY, 4, 0), pacific(TODAY, 14, 0));
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
    expect(future.detail.lowFt).toBeCloseTo(-1.9, 2);
  });
});

/* =========================================================================
 * The operator gate, composed
 * ======================================================================= */

describe('gate hours', () => {
  /** A low at 06:30, well inside daylight and well outside gate hours. */
  const dayWithEarlyLow = (lowFt: number): TideSeries =>
    seriesFromTurns(TODAY, [
      { hour: 12, ft: 4.5, dayOffset: -1 },
      { hour: 19, ft: 4.2, dayOffset: -1 },
      { hour: 6, minute: 30, ft: lowFt },
      { hour: 13, ft: 4.6 },
      { hour: 19, minute: 30, ft: 1.4 },
      { hour: 6, ft: 5.0, dayOffset: 1 },
      { hour: 13, ft: 0.2, dayOffset: 1 },
      { hour: 7, ft: 5.1, dayOffset: 2 },
    ]);

  const cabrilloGate = (date: LocalDate = TODAY) =>
    gateWindowFor('cabrillo-tidepools', date, ZONE);

  it('closes a daylight window that falls before the gate opens', () => {
    const series = dayWithEarlyLow(-1.6);
    const nowMs = pacific(TODAY, 4, 0);

    // Ungated, this is a usable window: light, low enough, long enough.
    expect(evaluateWindow(baseInput({ series, nowMs })).state).toBe('go');

    // Gated, the same day is shut, and the sentence is tidepool's.
    const gated = evaluateWindow(baseInput({ series, nowMs, gate: cabrilloGate() }));
    expect(gated.state).toBe('closed');
    expect(gated.reason).toMatch(/^The tide drops below the floor, but the window falls outside gate hours/);
    expect(gated.reason).toMatch(/9:00/);
  });

  it('is a no-op when the spot has no gate', () => {
    // 25 of 26 spots. The predicate must be byte-for-byte what it was.
    const series = dayWithEarlyLow(-1.6);
    const nowMs = pacific(TODAY, 4, 0);
    expect(evaluateWindow(baseInput({ series, nowMs, gate: null }))).toEqual(
      evaluateWindow(baseInput({ series, nowMs })),
    );
  });

  it('does not conflate a shut gate with darkness', () => {
    // A window that daylight already emptied is `dark`, gate or no gate. The
    // gate only gets to claim a window daylight left something of.
    const series = seriesFromTurns(TODAY, [
      { hour: 12, ft: 4.5, dayOffset: -1 },
      { hour: 19, ft: 4.2, dayOffset: -1 },
      { hour: 2, minute: 30, ft: -1.6 },
      { hour: 9, ft: 4.6 },
      { hour: 19, minute: 30, ft: 1.4 },
      { hour: 6, ft: 5.0, dayOffset: 1 },
      { hour: 13, ft: 0.2, dayOffset: 1 },
      { hour: 7, ft: 5.1, dayOffset: 2 },
    ]);
    const nowMs = pacific(TODAY, 1, 0);
    expect(evaluateWindow(baseInput({ series, nowMs })).state).toBe('dark');
    expect(evaluateWindow(baseInput({ series, nowMs, gate: cabrilloGate() })).state).toBe('dark');
  });

  it('reports a published annual closure by name', () => {
    const xmas: LocalDate = { year: 2026, month: 12, day: 25 };
    const series = seriesFromTurns(xmas, [
      { hour: 12, ft: 4.5, dayOffset: -1 },
      { hour: 19, ft: 4.2, dayOffset: -1 },
      { hour: 12, ft: -1.6 },
      { hour: 18, ft: 4.6 },
      { hour: 6, ft: 5.0, dayOffset: 1 },
      { hour: 13, ft: 0.2, dayOffset: 1 },
      { hour: 7, ft: 5.1, dayOffset: 2 },
    ]);
    const result = evaluateWindow(
      baseInput({
        series,
        date: xmas,
        nowMs: utcMsFromZoned({ ...xmas, hour: 8, minute: 0 }, ZONE),
        gate: cabrilloGate(xmas),
      }),
    );
    // Midday on Christmas: light, low enough, and the park does not open.
    expect(result.state).toBe('closed');
    expect(result.reason).toMatch(/Christmas Day/);
  });
});

/* =========================================================================
 * Refusals this activity owns
 * ======================================================================= */

describe('refusals', () => {
  it('throws on a non-finite floor rather than guessing one', () => {
    expect(() => evaluateWindow(baseInput({ floorFt: NaN }))).toThrow(/floorFt must be a finite/);
    expect(() => evaluateWindow(baseInput({ floorFt: null as unknown as number }))).toThrow(
      /floorFt must be a finite/,
    );
  });

  it('surfaces the swell gate’s refusal rather than swallowing it', () => {
    expect(() => evaluateWindow(baseInput({ currentSwellFt: NaN }))).toThrow(
      /finite number or null/,
    );
  });

  it('surfaces the series-coverage refusal, naming itself', () => {
    const shortSeries = seriesFromTurns(TODAY, [
      { hour: 10, ft: 4.0 },
      { hour: 16, ft: -1.0 },
      { hour: 22, ft: 4.0 },
    ]);
    expect(() => evaluateWindow(baseInput({ series: shortSeries }))).toThrow(
      /evaluateWindow: the series does not cover/,
    );
  });
});

/* =========================================================================
 * Against the captured predictions
 * ======================================================================= */

describe('the real 27 July corridor tide', () => {
  const series = loadCoopsFixture('coops-9410230-20260727-6min.json');

  /*
   * intertidal.json floors, verbatim.
   *
   * All five read `dark`, and that is the 1.2.0 change showing up: under the
   * 1.1.x floors (-0.2 to -0.8) four of these five read `above-floor` -- the reef
   * never surfaces at all -- because only Cabrillo's -0.2 was shallow enough for
   * the 03:21 low at -0.324 ft to clear. Raising the band to +0.7..+1.3 puts every
   * spot under its floor that morning, which moves the reason a reader is given
   * from "this reef does not surface" to the true one: it surfaces at 03:21, in
   * the dark. The verdict is the same. The explanation was wrong.
   */
  const cases = [
    { slug: 'cabrillo-tidepools', floorFt: 1.3, lat: 32.669, lon: -117.245, expected: 'dark' },
    { slug: 'la-jolla-cove', floorFt: 1.1, lat: 32.85, lon: -117.272, expected: 'dark' },
    { slug: 'windansea', floorFt: 1.0, lat: 32.832, lon: -117.28, expected: 'dark' },
    { slug: 'la-jolla-shores', floorFt: 0.8, lat: 32.857, lon: -117.257, expected: 'dark' },
    { slug: 'sunset-cliffs', floorFt: 0.7, lat: 32.723, lon: -117.256, expected: 'dark' },
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

  it('puts the only sub-floor low at 3:21 am, which is why it is dark not above-floor', () => {
    /*
     * THE PHANTOM WINDOW, end to end.
     *
     * core/window/solve.test.ts holds the solver-level regression -- the
     * afternoon low is inside no interval at all. This is what that buys a
     * reader: the distinction the bug erased, held at -0.2 ft, Cabrillo's floor
     * before 1.2.0, because that is the exact configuration it appeared in.
     *
     * -0.2 IS cleared that day, by the 03:21 low at -0.324 ft, so the honest
     * answer is that the workable window is in the dark, not that the reef never
     * surfaces. The afternoon low at 2.581 ft must not be selected just because
     * it happens to sit in daylight with a twelve-hour phantom window attached.
     */
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
    expect(result.detail.lowFt).toBeCloseTo(-0.324, 2);
    // 10:21Z is 03:21 PDT.
    expect(result.detail.lowMs).toBeGreaterThan(pacific(TODAY, 3, 20));
    expect(result.detail.lowMs).toBeLessThan(pacific(TODAY, 3, 23));
    expect(result.detail.lowMs).toBeLessThan(result.sunriseMs);
    // One window that day, and it is the 03:21 one -- not a phantom spanning the
    // intervening high.
    expect(result.windows).toHaveLength(1);
  });

  it('no corridor tidepool spot has a usable window on 2026-07-27', () => {
    // Worth stating plainly: the day this was built, every one of the eight spots
    // was unusable. A grid that showed a green cell here would be wrong. This
    // survived the 1.2.0 floor raise unchanged -- the raise was about giving the
    // right reason on an ordinary day, not about manufacturing green cells, and
    // 27 July stays a no at every floor in the new band.
    const floors = [0.7, 0.8, 0.9, 0.9, 1.0, 1.0, 1.1, 1.3];
    const results = floors.map((floorFt) =>
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
    );
    expect(results.every((r) => !STATE_PRESENTATION[r.state].usable)).toBe(true);
    expect(countUsable(results)).toBe(0);
  });
});
