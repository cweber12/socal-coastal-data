/*
 * Surf's PREDICATE and its JUDGEMENTS.
 *
 * What is NOT here any more, because #130 moved the code it tested into
 * core/window/ and the tests with it:
 *
 *   the maximal-run walk, and that runs are never adjacent   solve.test.ts
 *   the anchors an interval contains, on 2026-07-21 and -22  solve.test.ts
 *   the exact tie at 22:36 on 2026-07-21                     solve.test.ts
 *   the daylight and gate clips, and `gateBlocked`           gates.test.ts
 *   the swell window, the horizon, and the NaN refusal       gates.test.ts
 *   the gate states' precedence                              states.test.ts
 *   the tide builder                                         __testing__/series
 *
 * What is here is what only surf can answer: the band, the two-sided swell
 * window this activity needed, which session the day is about, and the sentences
 * a reader is shown.
 */
import { describe, expect, it } from 'vitest';

import {
  countSessions,
  countUsable,
  evaluateSurfDay,
  MIN_SESSION_MINUTES,
  sessionLighting,
  SWELL_HORIZON_DAYS,
  type SurfInput,
} from './policy';
import { coreStatesIn, STATE_PRESENTATION, SURF_STATES } from './states';
import { CORE_STATES } from '../../core/window/states';
import { SURF_SWELL_MINIMUM, SURF_TIDE_BAND } from './thresholds';
import type { TideSeries } from '../../core/feeds/coops-predictions';
import { gateWindowFor } from '../../core/spot/access';
import type { LocalDate } from '../../core/time';
import {
  flatSeries,
  loadCoopsFixture,
  pacific,
  seriesFromTurns,
  ZONE,
} from '../../core/window/__testing__/series';

/** Windansea. A reef break, and a surf-zone member on any reading. */
const LAT = 32.832;
const LON = -117.28;

/** The band the shipped file declares, so the fixture tests move with it. */
const BAND = { minFt: SURF_TIDE_BAND.minFt, maxFt: SURF_TIDE_BAND.maxFt };

const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };

/**
 * A corridor-shaped day whose tide crosses the band twice around a midday low,
 * giving one session that brackets that low.
 */
function dayCrossingTheBandAroundALow(): TideSeries {
  return seriesFromTurns(TODAY, [
    { hour: 12, ft: 4.8, dayOffset: -1 },
    { hour: 19, ft: 0.6, dayOffset: -1 },
    { hour: 4, ft: 5.0 },
    { hour: 13, ft: 2.5 },
    { hour: 20, ft: 5.2 },
    { hour: 4, ft: 0.4, dayOffset: 1 },
    { hour: 12, ft: 5.0, dayOffset: 1 },
    { hour: 20, ft: 0.5, dayOffset: 1 },
    { hour: 8, ft: 5.1, dayOffset: 2 },
  ]);
}

const baseInput = (over: Partial<SurfInput> = {}): SurfInput => ({
  series: dayCrossingTheBandAroundALow(),
  date: TODAY,
  band: BAND,
  swellCeilingFt: 3.0,
  swellMinimumFt: 1.0,
  currentSwellFt: 2.0,
  nowMs: pacific(TODAY, 6, 0),
  lat: LAT,
  lon: LON,
  timeZone: ZONE,
  ...over,
});

const realSeries = loadCoopsFixture('coops-9410230-20260713-384h.json');
const JULY_21: LocalDate = { year: 2026, month: 7, day: 21 };
const JULY_22: LocalDate = { year: 2026, month: 7, day: 22 };

/** A date well before the fixture, so nothing under test is "today". */
const NOT_TODAY = pacific({ year: 2026, month: 7, day: 15 }, 8);

const realDay = (date: LocalDate, over: Partial<SurfInput> = {}) =>
  evaluateSurfDay(
    baseInput({ series: realSeries, date, nowMs: NOT_TODAY, currentSwellFt: null, ...over }),
  );

/* =========================================================================
 * The shape that made surf the second activity
 * ======================================================================= */

describe('N sessions, not one window', () => {
  it('2026-07-22 crosses the band four times and produces exactly two sessions', () => {
    /*
     * #129's ACCEPTANCE CRITERION, against committed data, kept here because it
     * is a claim about a surf DAY rather than about the solver.
     *
     * Station 9410230, local day 2026-07-22. The four crossings, read off the
     * fixture: 1.5 rising 00:44:52, 3.5 rising 12:59:12, 3.5 falling 20:11:06,
     * 1.5 falling 22:47:11. Two crossings open a session and two close one, so
     * four crossings are two sessions -- and the one-window-per-low predicate
     * tidepool uses returns one for this day whatever level it is given.
     */
    const result = realDay(JULY_22);
    expect(result.windows).toHaveLength(2);

    const [first, second] = result.windows;
    expect(first!.startMs).toBeCloseTo(pacific(JULY_22, 0, 44) + 52_000, -4);
    expect(first!.endMs).toBeCloseTo(pacific(JULY_22, 12, 59) + 12_000, -4);
    expect(second!.startMs).toBeCloseTo(pacific(JULY_22, 20, 11) + 6_000, -4);
    expect(second!.endMs).toBeCloseTo(pacific(JULY_22, 22, 47) + 11_000, -4);

    // Neither session runs past midnight in either direction, so this day's two
    // sessions are wholly its own.
    expect(first!.continuesBefore).toBe(false);
    expect(second!.continuesAfter).toBe(false);
  });

  it('clips a session already under way at local midnight, and says so', () => {
    // The day clip is surf's, not the solver's: the solver reports the whole run
    // and this decides how much of it belongs to this day. Reporting the start
    // as 00:00 with no flag would be a claim the tide crossed the edge at
    // midnight.
    const result = realDay(JULY_21);
    const first = result.windows[0]!;
    expect(first.continuesBefore).toBe(true);
    expect(first.startMs).toBe(pacific(JULY_21, 0));
  });

  it('a whole fortnight of real days never produces a zero-length session', () => {
    // A run of one sample, or a crossing pair that interpolates backwards, would
    // show up here as a session with no duration. Fifteen consecutive real days
    // is a wider net than any single constructed case.
    for (let day = 13; day <= 27; day++) {
      const result = realDay({ year: 2026, month: 7, day });
      for (const session of result.windows) {
        expect(session.endMs, `${day} July`).toBeGreaterThan(session.startMs);
      }
    }
  });
});

/* =========================================================================
 * The band predicate, and the state it emits
 * ======================================================================= */

describe('the band predicate at its edges', () => {
  it('a day entirely above the band never enters it', () => {
    const result = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 5.0) }));
    expect(result.windows).toEqual([]);
    expect(result.state).toBe('out-of-band');
    expect(result.reason).toMatch(/never drops into/);
    expect(result.reason).toMatch(/above the top of it/);
  });

  it('a day entirely below the band never enters it', () => {
    const result = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 0.4) }));
    expect(result.windows).toEqual([]);
    expect(result.state).toBe('out-of-band');
    expect(result.reason).toMatch(/never rises into/);
    expect(result.reason).toMatch(/below the bottom of it/);
  });

  it('the two out-of-band directions give different reasons', () => {
    // The distinction tidepool's `above-floor` does not have to make. A day that
    // never gets under the top of the band and a day that never gets over the
    // bottom are opposite problems, and a reader planning a week needs to know
    // which one they are looking at.
    const above = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 5.0) })).reason;
    const below = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 0.4) })).reason;
    expect(above).not.toEqual(below);
  });

  it('a day that never leaves the band is one session spanning the whole day', () => {
    const result = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 2.5) }));
    expect(result.windows).toHaveLength(1);
    const session = result.windows[0]!;
    expect(session.continuesBefore).toBe(true);
    expect(session.continuesAfter).toBe(true);
    expect(session.startMs).toBe(pacific(TODAY, 0));
    // The whole local day, to the minute. 24 h, or 1440 min.
    expect((session.endMs - session.startMs) / 60_000).toBeCloseTo(1440, 0);
  });

  it('both edges are strict: a tide sitting exactly on one is out of band', () => {
    // Held at exactly an edge for three days. Every sample reads it and the
    // comparison is strict on both sides, so there is no session at all -- not a
    // 24-hour one.
    expect(evaluateSurfDay(baseInput({ series: flatSeries(TODAY, BAND.minFt) })).state).toBe(
      'out-of-band',
    );
    expect(evaluateSurfDay(baseInput({ series: flatSeries(TODAY, BAND.maxFt) })).state).toBe(
      'out-of-band',
    );
  });

  it('out-of-band outranks every gate: nothing was there for a gate to shut', () => {
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    const result = evaluateSurfDay(
      baseInput({ series: flatSeries(TODAY, 5.0), gate, currentSwellFt: 9.9 }),
    );
    expect(result.state).toBe('out-of-band');
  });

  it('reports the day’s range against the band, for the cell face', () => {
    const result = evaluateSurfDay(baseInput());
    expect(result.detail.dayLowFt).toBeLessThan(result.detail.dayHighFt);
    expect(result.detail.band).toEqual(BAND);
    // Normally four turns on a mixed-semidiurnal day.
    expect(result.detail.extrema.length).toBeGreaterThan(0);
  });
});

/* =========================================================================
 * The sentences, which are this activity's
 * ======================================================================= */

describe('the day state', () => {
  it('is go when a session clears everything', () => {
    const result = evaluateSurfDay(baseInput());
    expect(result.state, result.reason).toBe('go');
    expect(result.detail.best).not.toBeNull();
  });

  it('is veto when a known swell is over the ceiling', () => {
    const result = evaluateSurfDay(baseInput({ currentSwellFt: 4.2, swellCeilingFt: 3.0 }));
    expect(result.state).toBe('veto');
    expect(result.reason).toMatch(/Called off/);
  });

  it('is flat when a known swell is under the minimum', () => {
    /*
     * The state this activity needed and tidepool has no use for. Tidepool reads
     * swell as a hazard only: over the ceiling and you should not be on the reef.
     * Surf reads it in both directions, because under the minimum there is simply
     * nothing there. Without it, a 0.4 ft reading with the tide in the band read
     * `go`.
     */
    const result = evaluateSurfDay(baseInput({ currentSwellFt: 0.4, swellMinimumFt: 1.0 }));
    expect(result.state).toBe('flat');
    expect(result.reason).toMatch(/nothing to ride/);
  });

  it('does not word flat as a refusal', () => {
    // `veto` is "do not go" and `flat` is "there is nothing there". A reader who
    // reads the two the same way treats a flat day as a dangerous one.
    const flat = evaluateSurfDay(baseInput({ currentSwellFt: 0.4 })).reason;
    expect(flat).not.toMatch(/[Cc]alled off/);
    expect(flat).not.toMatch(/[Vv]eto/);
  });

  it('is swell-tbd rather than flat when the buoy is silent', () => {
    // A null reading is unknown, never calm and never flat. Conflating the two
    // is the exact failure this repo is built around.
    const result = evaluateSurfDay(baseInput({ currentSwellFt: null }));
    expect(result.state).toBe('swell-tbd');
    expect(result.reason).toMatch(/unknown rather than flat/);
  });

  it('is swell-tbd past the horizon, and never go', () => {
    const dayFive: LocalDate = { year: 2026, month: 8, day: 1 };
    const result = evaluateSurfDay(
      baseInput({
        series: seriesFromTurns(dayFive, [
          { hour: 12, ft: 4.8, dayOffset: -1 },
          { hour: 4, ft: 5.0 },
          { hour: 13, ft: 2.5 },
          { hour: 20, ft: 5.2 },
          { hour: 12, ft: 5.0, dayOffset: 1 },
        ]),
        date: dayFive,
        nowMs: pacific(TODAY, 6),
        currentSwellFt: 2.0,
      }),
    );
    expect(result.daysFromToday).toBeGreaterThanOrEqual(SWELL_HORIZON_DAYS);
    expect(result.state).toBe('swell-tbd');
    expect(result.swellKnown).toBe(false);
    expect(result.swellFt).toBeNull();
  });

  it('is brief when the time LEFT in the best session is under the minimum', () => {
    /*
     * Driven off the now-clip rather than off a contrived tide, because that is
     * the case that actually reaches a reader: the sessions are hours long, and
     * what is left of the last one at 20 minutes to closing is not.
     *
     * Two passes. The first learns where the day's best session ends -- asking
     * the predicate rather than asserting a clock time computed by hand -- and
     * the second sets `now` twenty minutes inside it.
     */
    const survey = evaluateSurfDay(baseInput({ nowMs: NOT_TODAY }));
    const best = survey.detail.best!;

    const result = evaluateSurfDay(baseInput({ nowMs: best.usableEndMs - 20 * 60_000 }));

    expect(result.isToday).toBe(true);
    const bestRemaining = Math.max(...result.windows.map((s) => s.minutesRemaining ?? 0));
    expect(bestRemaining).toBeCloseTo(20, 0);
    expect(result.state).toBe('brief');
    expect(result.reason).toMatch(/The longest session is \d+ min, under the 45 min minimum/);
  });

  it('is dark when every session falls outside daylight', () => {
    const night = seriesFromTurns(TODAY, [
      { hour: 12, ft: 5.0, dayOffset: -1 },
      { hour: 21, ft: 5.0, dayOffset: -1 },
      { hour: 2, minute: 30, ft: 2.4 },
      { hour: 9, ft: 5.2 },
      { hour: 16, ft: 4.6 },
      { hour: 23, ft: 5.0 },
      { hour: 12, ft: 5.0, dayOffset: 1 },
      { hour: 12, ft: 5.0, dayOffset: 2 },
    ]);
    const result = evaluateSurfDay(baseInput({ series: night, nowMs: pacific(TODAY, 0, 1) }));
    expect(result.windows.length).toBeGreaterThan(0);
    expect(result.state).toBe('dark');
    expect(result.reason).toBe(
      'The tide is in the band, but there is no daylight left today while it is.',
    );

    // On any other day the sentence says where the sessions FELL, in the plural
    // -- where tidepool says "the window", singular. The two shapes differ and
    // the wording says so.
    const otherDay = evaluateSurfDay(
      baseInput({ series: night, nowMs: pacific({ year: 2026, month: 7, day: 26 }, 8) }),
    );
    expect(otherDay.state).toBe('dark');
    expect(otherDay.reason).toBe(
      'The tide is in the band, but every session falls outside daylight.',
    );
  });

  it('is closed rather than dark when the gate is what took the session', () => {
    /*
     * Cabrillo is the one gated spot in the corridor and it is a surf-zone
     * member on the derived rule, so this case is reachable rather than
     * hypothetical. The session runs roughly 02:34 to 08:05, so it is over
     * before the gate opens at 09:00 and it has two hours of daylight in it
     * after sunrise at 05:59. Daylight left something; the gate is what took it.
     */
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    expect(gate, 'cabrillo-tidepools must still carry a gate for this test to mean anything')
      .not.toBeNull();

    const earlyMorning = seriesFromTurns(TODAY, [
      { hour: 12, ft: 5.0, dayOffset: -1 },
      { hour: 23, ft: 5.0, dayOffset: -1 },
      { hour: 5, minute: 30, ft: 2.4 },
      { hour: 11, minute: 30, ft: 5.2 },
      { hour: 20, ft: 5.0 },
      { hour: 12, ft: 5.0, dayOffset: 1 },
      { hour: 12, ft: 5.0, dayOffset: 2 },
    ]);
    const result = evaluateSurfDay(
      baseInput({ series: earlyMorning, gate, nowMs: pacific(TODAY, 0, 1) }),
    );
    expect(result.state).toBe('closed');
    expect(result.reason).toMatch(/gate hours|closed all day/);
  });

  it('names the session count in go and brief, because the cell face shows it', () => {
    // Two days out, so the reading is inside the horizon and the day can clear.
    const go = evaluateSurfDay(
      baseInput({
        series: realSeries,
        date: JULY_22,
        nowMs: pacific({ year: 2026, month: 7, day: 20 }, 8),
      }),
    );
    expect(go.state).toBe('go');
    expect(go.windows).toHaveLength(2);
    expect(go.reason).toMatch(/the best of 2 today/);
  });

  it('has an empty disclosure list on an ordinary day', () => {
    expect(evaluateSurfDay(baseInput()).disclosures).toEqual([]);
  });
});

/* =========================================================================
 * Which session the day is about -- this activity's selection
 * ======================================================================= */

describe('the selection', () => {
  it('reports remaining minutes on today and null on any other day', () => {
    const today = evaluateSurfDay(baseInput({ nowMs: pacific(TODAY, 6) }));
    expect(today.isToday).toBe(true);
    for (const session of today.windows) expect(session.minutesRemaining).not.toBeNull();

    const other = evaluateSurfDay(baseInput({ nowMs: pacific(TODAY, 6, 0) - 2 * 86_400_000 }));
    expect(other.isToday).toBe(false);
    for (const session of other.windows) expect(session.minutesRemaining).toBeNull();
  });

  it('picks the best session by time LEFT on today, not by total length', () => {
    /*
     * The rule that differs from tidepool's, and the reason neither belongs in
     * the solver. Tidepool has one window and asks how much of it is left. A
     * surf day routinely offers a dawn session and an evening one, so at 4 pm
     * the useful answer is the evening one even when the morning's was longer.
     */
    const twoSessions = seriesFromTurns(TODAY, [
      { hour: 12, ft: 5.0, dayOffset: -1 },
      { hour: 22, ft: 5.2, dayOffset: -1 },
      { hour: 7, ft: 0.5 },
      { hour: 12, minute: 30, ft: 5.0 },
      { hour: 18, ft: 0.5 },
      { hour: 23, minute: 30, ft: 5.0 },
      { hour: 12, ft: 5.0, dayOffset: 1 },
      { hour: 12, ft: 5.0, dayOffset: 2 },
    ]);

    const atDawn = evaluateSurfDay(baseInput({ series: twoSessions, nowMs: pacific(TODAY, 5) }));
    const lateAfternoon = evaluateSurfDay(
      baseInput({ series: twoSessions, nowMs: pacific(TODAY, 16) }),
    );

    expect(atDawn.windows.length).toBeGreaterThanOrEqual(2);
    expect(atDawn.detail.best!.startMs).toBeLessThan(lateAfternoon.detail.best!.startMs);
  });

  it('reports the day’s best session once every session has shut, not the first one', () => {
    /*
     * After the last session of today, every session has zero minutes left, so a
     * rule of "most remaining, earliest wins" picks whichever came first -- on
     * an ordinary corridor day a stretch at 1 a.m. with no daylight in it. The
     * day page then said "best: none usable" about a day that had offered five
     * and a half hours in the afternoon.
     *
     * The state is still `dark`, which is the true statement about the clock.
     * `best` is the true statement about the day.
     */
    const result = evaluateSurfDay(baseInput({ nowMs: pacific(TODAY, 23, 30) }));

    expect(result.state).toBe('dark');
    expect(result.windows.every((s) => (s.minutesRemaining ?? 0) === 0)).toBe(true);

    const longest = Math.max(...result.windows.map((s) => s.usableMinutes));
    expect(longest).toBeGreaterThan(0);
    expect(result.detail.best!.usableMinutes).toBe(longest);
    expect(result.detail.best).not.toBe(result.windows[0]);
  });
});

/* =========================================================================
 * Refusals this activity owns
 * ======================================================================= */

describe('what it refuses to guess', () => {
  it('throws on a non-finite band edge rather than inventing one', () => {
    expect(() => evaluateSurfDay(baseInput({ band: { minFt: NaN, maxFt: 3.5 } }))).toThrow(
      /finite/,
    );
  });

  it('throws on an empty band rather than reporting a quiet week', () => {
    expect(() => evaluateSurfDay(baseInput({ band: { minFt: 3.5, maxFt: 1.5 } }))).toThrow(
      /empty/,
    );
  });

  it('surfaces the swell gate’s refusal rather than swallowing it', () => {
    // NaN compares false against both `> ceiling` and `< minimum`, so it would
    // fall through the middle and read as a clean pass.
    expect(() => evaluateSurfDay(baseInput({ currentSwellFt: NaN }))).toThrow(/finite/);
  });

  it('surfaces the series-coverage refusal, naming itself', () => {
    const short = seriesFromTurns(TODAY, [
      { hour: 4, ft: 5.0 },
      { hour: 13, ft: 2.5 },
      { hour: 16, ft: 4.0 },
    ]);
    expect(() => evaluateSurfDay(baseInput({ series: short }))).toThrow(
      /evaluateSurfDay: the series does not cover/,
    );
  });
});

/* =========================================================================
 * States and presentation
 * ======================================================================= */

describe('states and presentation', () => {
  it('has a row for every state and nothing else', () => {
    expect(SURF_STATES).toHaveLength(8);
    expect(Object.keys(STATE_PRESENTATION)).toEqual([...SURF_STATES]);
  });

  it('reaches every gate state, including the one tidepool cannot', () => {
    // `flat` needs a swell minimum, and this activity declares one.
    expect(SURF_STATES).toContain('flat');
    expect(coreStatesIn(SURF_STATES)).toEqual([...CORE_STATES]);
  });

  it('does not reorder the shared precedence while putting out-of-band at the front', () => {
    expect(SURF_STATES[0]).toBe('out-of-band');
    expect(coreStatesIn(SURF_STATES)).toEqual([...CORE_STATES]);
  });

  it('go is the only usable state', () => {
    expect(SURF_STATES.filter((s) => STATE_PRESENTATION[s].usable)).toEqual(['go']);
  });

  it('words veto for a surfer rather than for a tidepooler', () => {
    // Over the ceiling is a hazard on a reef and a size call in the water.
    expect(STATE_PRESENTATION.veto.label).toBe('Too big');
  });

  it('no glyph collides with a tide arrow', () => {
    for (const state of SURF_STATES) {
      expect(STATE_PRESENTATION[state].glyph).not.toBe('▲');
      expect(STATE_PRESENTATION[state].glyph).not.toBe('▼');
    }
  });

  it('counts usable days and total sessions across a set', () => {
    const go = evaluateSurfDay(baseInput());
    const flat = evaluateSurfDay(baseInput({ currentSwellFt: 0.4 }));
    expect(countUsable([go, flat])).toBe(1);
    expect(countSessions([go, flat])).toBe(go.windows.length + flat.windows.length);
  });
});

/* =========================================================================
 * Against the captured predictions
 * ======================================================================= */

describe('the real corridor tide, 1.5–3.5 ft band', () => {
  it('every real day in the fixture is swell-tbd with no buoy reading, never go', () => {
    // The invariant that matters most: an unknown may never render as a pass. On
    // these fifteen days the tide is in the band constantly, so every one of
    // them would read `go` if a null swell were treated as calm.
    for (let day = 13; day <= 27; day++) {
      const result = realDay({ year: 2026, month: 7, day });
      expect(result.state, `${day} July`).not.toBe('go');
    }
  });

  it('the shipped band and minimum load and are uncalibrated', () => {
    // Guards the file, not the predicate. If either is ever promoted, the
    // disclosure copy on the page stops being true and this fails first.
    expect(SURF_TIDE_BAND.confidence).toBe('uncalibrated');
    expect(SURF_SWELL_MINIMUM.confidence).toBe('uncalibrated');
    expect(SURF_TIDE_BAND.minFt).toBeLessThan(SURF_TIDE_BAND.maxFt);
  });
});

describe('session lighting', () => {
  it('is measured at the midpoint, so a dawn session reads as daylight', () => {
    /*
     * A session opening before sunrise and running well into the morning is a
     * daylight session, and shading it on its start instant -- which is what a
     * tidepool cell does with its low -- would call it a night one.
     *
     * Rises off a 02:30 low, entering the band around 05:09 and leaving it
     * around 07:40. Sunrise at Windansea on 27 July is 05:59, so the session
     * opens in the dark and spends two thirds of itself in daylight.
     */
    const dawn = seriesFromTurns(TODAY, [
      { hour: 12, ft: 5.0, dayOffset: -1 },
      { hour: 20, ft: 5.0, dayOffset: -1 },
      { hour: 2, minute: 30, ft: 0.5 },
      { hour: 11, ft: 5.0 },
      { hour: 18, ft: 5.0 },
      { hour: 12, ft: 5.0, dayOffset: 1 },
      { hour: 12, ft: 5.0, dayOffset: 2 },
    ]);
    const result = evaluateSurfDay(baseInput({ series: dawn, nowMs: pacific(TODAY, 0, 1) }));
    const rising = result.windows.find((s) => s.startMs > pacific(TODAY, 2, 30))!;
    expect(rising.startMs).toBeLessThan(result.sunriseMs);
    expect(rising.endMs).toBeGreaterThan(result.sunriseMs);
    expect(sessionLighting(rising, result)).toBe('day');
  });
});
