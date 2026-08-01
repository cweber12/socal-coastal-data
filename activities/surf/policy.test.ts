import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  countSessions,
  countUsable,
  evaluateSurfDay,
  MIN_SESSION_MINUTES,
  sessionLighting,
  SWELL_HORIZON_DAYS,
  type SurfInput,
} from './policy';
import { STATE_PRESENTATION, SURF_STATES, type SurfState } from './states';
import { SURF_SWELL_MINIMUM, SURF_TIDE_BAND } from './thresholds';
import { parseCoopsSeries, type CoopsRequestContract, type TideSeries } from '../../core/feeds/coops-predictions';
import { gateWindowFor } from '../../core/spot/access';
import { utcMsFromZoned, type LocalDate } from '../../core/time';

const ZONE = 'America/Los_Angeles';

/** Windansea. A reef break, and a surf-zone member on any reading. */
const LAT = 32.832;
const LON = -117.28;

const CONTRACT: CoopsRequestContract = {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
};

/** The band the shipped file declares, so the fixture tests move with it. */
const BAND = { minFt: SURF_TIDE_BAND.minFt, maxFt: SURF_TIDE_BAND.maxFt };

/* ---------------------------------------------------------------------------
 * A tide builder, so each state can be produced deliberately.
 *
 * Extrema are given explicitly and the curve between consecutive ones is a half
 * cosine, which has zero slope at both ends, so the turns land exactly where
 * they were asked for. Lifted from activities/tidepool/policy.test.ts along with
 * the predicate it tests -- the same copy, for the same reason.
 * ------------------------------------------------------------------------- */

interface Turn {
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

/** A series held at one height for three days. For the never-entered cases. */
function flatSeries(day: LocalDate, ft: number): TideSeries {
  return seriesFromTurns(day, [
    { hour: 0, ft, dayOffset: -1 },
    { hour: 12, ft, dayOffset: -1 },
    { hour: 12, ft },
    { hour: 12, ft, dayOffset: 1 },
    { hour: 12, ft, dayOffset: 2 },
  ]);
}

const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };
const pacific = (day: LocalDate, hour: number, minute = 0) =>
  utcMsFromZoned({ ...day, hour, minute }, ZONE);

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

/* =========================================================================
 * The shape that made surf the second activity
 * ======================================================================= */

describe('N sessions, not one window', () => {
  it('returns every maximal in-band interval, in time order', () => {
    const result = evaluateSurfDay(baseInput());
    expect(result.sessions.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.sessions.length; i++) {
      expect(result.sessions[i]!.startMs).toBeGreaterThan(result.sessions[i - 1]!.endMs);
    }
  });

  it('a session brackets the low it surrounds, and reports it as an anchor', () => {
    const result = evaluateSurfDay(baseInput());
    const around = result.sessions.find((s) => s.anchors.some((a) => a.kind === 'low'));
    expect(around, result.reason).toBeDefined();
    expect(around!.startMs).toBeLessThan(pacific(TODAY, 13));
    expect(around!.endMs).toBeGreaterThan(pacific(TODAY, 13));
  });

  it('sessions are never adjacent: the tide leaves the band between them', () => {
    // Two runs that touched would be one run. What separates two sessions is a
    // real event with a time, not a gap in the sampling -- so any pair must be
    // separated by at least one sample interval.
    const result = evaluateSurfDay(baseInput({ series: realSeries, date: JULY_22 }));
    for (let i = 1; i < result.sessions.length; i++) {
      const gapMs = result.sessions[i]!.startMs - result.sessions[i - 1]!.endMs;
      expect(gapMs).toBeGreaterThan(6 * 60_000);
    }
  });
});

/* =========================================================================
 * The band's edges
 * ======================================================================= */

describe('the band predicate at its edges', () => {
  it('a day entirely above the band never enters it', () => {
    const result = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 5.0) }));
    expect(result.sessions).toEqual([]);
    expect(result.state).toBe('out-of-band');
    expect(result.reason).toMatch(/never drops into/);
    expect(result.reason).toMatch(/above the top of it/);
  });

  it('a day entirely below the band never enters it', () => {
    const result = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, 0.4) }));
    expect(result.sessions).toEqual([]);
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
    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0]!;
    expect(session.continuesBefore).toBe(true);
    expect(session.continuesAfter).toBe(true);
    expect(session.startMs).toBe(pacific(TODAY, 0));
    // The whole local day, to the minute. 24 h, or 1440 min.
    expect((session.endMs - session.startMs) / 60_000).toBeCloseTo(1440, 0);
  });

  it('both edges are strict: a tide sitting exactly on one is out of band', () => {
    // Held at exactly the lower edge for three days. Every sample reads 1.5 and
    // `minFt < ft` is false for all of them, so there is no session at all --
    // not a 24-hour one.
    const onTheEdge = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, BAND.minFt) }));
    expect(onTheEdge.sessions).toEqual([]);
    expect(onTheEdge.state).toBe('out-of-band');

    const onTheTop = evaluateSurfDay(baseInput({ series: flatSeries(TODAY, BAND.maxFt) }));
    expect(onTheTop.sessions).toEqual([]);
    expect(onTheTop.state).toBe('out-of-band');
  });

  it('a single sample exactly on an edge does not open a session', () => {
    /*
     * The exact-tie case, constructed rather than found: a tide that rises to
     * touch the lower edge and falls away again. One sample reads 1.500 and its
     * neighbours are below, so a solver using `<=` would open a session lasting
     * one sample interval and a solver using `<` opens none. Six minutes is far
     * under MIN_SESSION_MINUTES either way, so the state is the same and the
     * SESSION COUNT is not -- which is what a reader sees on the cell face.
     */
    const touching = seriesFromTurns(TODAY, [
      { hour: 12, ft: 0.5, dayOffset: -1 },
      { hour: 0, ft: 0.5 },
      { hour: 12, ft: BAND.minFt },
      { hour: 23, minute: 59, ft: 0.5 },
      { hour: 12, ft: 0.5, dayOffset: 1 },
      { hour: 12, ft: 0.5, dayOffset: 2 },
    ]);
    const result = evaluateSurfDay(baseInput({ series: touching }));
    expect(result.sessions).toEqual([]);
    expect(result.state).toBe('out-of-band');
  });
});

/* =========================================================================
 * Gates, in precedence order
 * ======================================================================= */

describe('the day state', () => {
  it('is go when a session clears everything', () => {
    const result = evaluateSurfDay(baseInput());
    expect(result.state, result.reason).toBe('go');
    expect(result.best).not.toBeNull();
  });

  it('is veto when a known swell is over the ceiling', () => {
    const result = evaluateSurfDay(baseInput({ currentSwellFt: 4.2, swellCeilingFt: 3.0 }));
    expect(result.state).toBe('veto');
    expect(result.reason).toMatch(/Called off/);
  });

  it('is flat when a known swell is under the minimum', () => {
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

  it('is swell-tbd rather than flat when the buoy is silent', () => {
    // A null reading is unknown, never calm and never flat. Conflating the two
    // is the exact failure this repo is built around.
    const result = evaluateSurfDay(baseInput({ currentSwellFt: null }));
    expect(result.state).toBe('swell-tbd');
    expect(result.reason).toMatch(/unknown rather than flat/);
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
     *
     * The BEST session rather than the last: this day's last band crossing runs
     * into the night, so its usable minutes are already zero from the daylight
     * clip and twenty minutes before the end of nothing is still nothing.
     */
    const survey = evaluateSurfDay(baseInput({ nowMs: NOT_TODAY }));
    const best = survey.best!;

    const result = evaluateSurfDay(baseInput({ nowMs: best.usableEndMs - 20 * 60_000 }));

    expect(result.isToday).toBe(true);
    const bestRemaining = Math.max(...result.sessions.map((s) => s.minutesRemaining ?? 0));
    expect(bestRemaining).toBeCloseTo(20, 0);
    expect(bestRemaining).toBeLessThan(MIN_SESSION_MINUTES);
    expect(result.state).toBe('brief');
    expect(result.reason).toMatch(/under the 45 min minimum/);
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
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.state).toBe('dark');
  });

  it('is closed rather than dark when the gate is what took the session', () => {
    /*
     * Cabrillo is the one gated spot in the corridor and it is a surf-zone
     * member on the derived rule, so this case is reachable rather than
     * hypothetical. The session runs in broad daylight and outside gate hours.
     */
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    expect(gate, 'cabrillo-tidepools must still carry a gate for this test to mean anything')
      .not.toBeNull();

    // The session runs roughly 02:34 to 08:05, so it is over before the gate
    // opens at 09:00 and it has two hours of daylight in it after sunrise at
    // 05:59. Daylight left something; the gate is what took it.
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

  it('out-of-band outranks every gate: nothing was there for a gate to shut', () => {
    const gate = gateWindowFor('cabrillo-tidepools', TODAY, ZONE);
    const result = evaluateSurfDay(
      baseInput({ series: flatSeries(TODAY, 5.0), gate, currentSwellFt: 9.9 }),
    );
    expect(result.state).toBe('out-of-band');
  });
});

/* =========================================================================
 * Today
 * ======================================================================= */

describe('today', () => {
  it('reports remaining minutes on today and null on any other day', () => {
    const today = evaluateSurfDay(baseInput({ nowMs: pacific(TODAY, 6) }));
    expect(today.isToday).toBe(true);
    for (const session of today.sessions) expect(session.minutesRemaining).not.toBeNull();

    const other = evaluateSurfDay(baseInput({ nowMs: pacific(TODAY, 6, 0) - 2 * 86_400_000 }));
    expect(other.isToday).toBe(false);
    for (const session of other.sessions) expect(session.minutesRemaining).toBeNull();
  });

  it('picks the best session by time LEFT on today, not by total length', () => {
    /*
     * The rule that differs from tidepool's, and the reason it does. Tidepool
     * has one window and asks how much of it is left. A surf day routinely
     * offers a dawn session and an evening one, so at 4 pm the useful answer is
     * the evening one even when the morning's was longer.
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

    const atDawn = evaluateSurfDay(
      baseInput({ series: twoSessions, nowMs: pacific(TODAY, 5) }),
    );
    const lateAfternoon = evaluateSurfDay(
      baseInput({ series: twoSessions, nowMs: pacific(TODAY, 16) }),
    );

    expect(atDawn.sessions.length).toBeGreaterThanOrEqual(2);
    expect(atDawn.best!.startMs).toBeLessThan(lateAfternoon.best!.startMs);
  });
});

/* =========================================================================
 * Refusals
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

  it('throws on a NaN swell rather than letting it pass between the two limits', () => {
    // NaN compares false against both `> ceiling` and `< minimum`, so it would
    // fall through the middle and read as a clean pass.
    expect(() => evaluateSurfDay(baseInput({ currentSwellFt: NaN }))).toThrow(/finite/);
  });

  it('throws when the series does not cover the day', () => {
    const short = seriesFromTurns(TODAY, [
      { hour: 4, ft: 5.0 },
      { hour: 13, ft: 2.5 },
      { hour: 16, ft: 4.0 },
    ]);
    expect(() => evaluateSurfDay(baseInput({ series: short }))).toThrow(/does not cover/);
  });
});

/* =========================================================================
 * Presentation invariants
 * ======================================================================= */

describe('states and presentation', () => {
  it('every state has a presentation row', () => {
    for (const state of SURF_STATES) {
      expect(STATE_PRESENTATION[state as SurfState]).toBeDefined();
    }
    expect(Object.keys(STATE_PRESENTATION).sort()).toEqual([...SURF_STATES].sort());
  });

  it('go is the only usable state', () => {
    const usable = SURF_STATES.filter((s) => STATE_PRESENTATION[s].usable);
    expect(usable).toEqual(['go']);
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
    expect(countSessions([go, flat])).toBe(go.sessions.length + flat.sessions.length);
  });
});

/* =========================================================================
 * Against the captured predictions
 *
 * The acceptance criteria for #129, answered with real CO-OPS predictions for
 * station 9410230 rather than a constructed day. Every number asserted below was
 * read off the committed fixture before the predicate existed.
 * ======================================================================= */

const realSeries = parseCoopsSeries(
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../core/feeds/__fixtures__/coops-9410230-20260713-384h.json', import.meta.url),
      ),
      'utf8',
    ),
  ),
  CONTRACT,
);

const JULY_21: LocalDate = { year: 2026, month: 7, day: 21 };
const JULY_22: LocalDate = { year: 2026, month: 7, day: 22 };

/** A date well before the fixture, so nothing under test is "today". */
const NOT_TODAY = pacific({ year: 2026, month: 7, day: 15 }, 8);

const realDay = (date: LocalDate, over: Partial<SurfInput> = {}) =>
  evaluateSurfDay(
    baseInput({ series: realSeries, date, nowMs: NOT_TODAY, currentSwellFt: null, ...over }),
  );

describe('the real corridor tide, 1.5–3.5 ft band', () => {
  it('2026-07-22 crosses the band four times and produces exactly two sessions', () => {
    /*
     * THE ACCEPTANCE CRITERION, against committed data.
     *
     * Station 9410230, local day 2026-07-22. The four crossings, read off the
     * fixture: 1.5 rising 00:44:52, 3.5 rising 12:59:12, 3.5 falling 20:11:06,
     * 1.5 falling 22:47:11. Two crossings open a session and two close one, so
     * four crossings are two sessions -- and the tidepool solver, which anchors
     * on a low and walks one excursion, returns one window for this day whatever
     * level it is given.
     */
    const result = realDay(JULY_22);

    expect(result.sessions).toHaveLength(2);

    const [first, second] = result.sessions as [
      (typeof result.sessions)[number],
      (typeof result.sessions)[number],
    ];

    // Within a minute of the interpolated crossing. The band edges are quoted to
    // one decimal and the predictions to three, so the crossing is well
    // conditioned -- the tide is moving fast where it cuts the edge.
    expect(first.startMs).toBeCloseTo(pacific(JULY_22, 0, 44) + 52_000, -4);
    expect(first.endMs).toBeCloseTo(pacific(JULY_22, 12, 59) + 12_000, -4);
    expect(second.startMs).toBeCloseTo(pacific(JULY_22, 20, 11) + 6_000, -4);
    expect(second.endMs).toBeCloseTo(pacific(JULY_22, 22, 47) + 11_000, -4);

    // Neither session runs past midnight in either direction, so this day's two
    // sessions are wholly its own.
    expect(first.continuesBefore).toBe(false);
    expect(second.continuesAfter).toBe(false);
  });

  it('2026-07-22 straddles both anchor kinds in one session and anchors the other on nothing', () => {
    /*
     * THE FINDING #130 IS WAITING ON, and it is a single real day.
     *
     * The first session contains the 2.816 ft high at 05:51 AND the 2.503 ft
     * low at 09:30 -- both inside the band, so there is no single extremum the
     * session could be said to belong to. The second contains no turn at all: it
     * is a pass-through on the ebb off the 5.017 ft high at 16:53, which is
     * above the band and outside the session entirely.
     *
     * An anchor-first solver has to name one extremum per window BEFORE it knows
     * whether the window contains one, and on this day it would have to name two
     * for one session and none for the other. That is the shape a general
     * `solve(series, anchor, holds)` has to accommodate, and it is why extracting
     * from tidepool plus dive would have got it wrong: both of those anchor on
     * exactly one turn by construction.
     *
     * The 05:51 high is worth a note of its own. A naive three-point scan misses
     * it -- the turn is a plateau, two adjacent samples at the same height -- and
     * `findExtrema` collapses runs of equal height precisely so a tie at the turn
     * is still a candidate. The first survey of this fixture, written in Python
     * with strict comparisons, reported this session as containing one turn.
     */
    const result = realDay(JULY_22);
    const [first, second] = result.sessions;

    expect(first!.anchors.map((a) => a.kind)).toEqual(['high', 'low']);
    expect(first!.anchors[0]!.ft).toBeCloseTo(2.816, 2);
    expect(first!.anchors[1]!.ft).toBeCloseTo(2.503, 2);

    expect(second!.anchors).toHaveLength(0);
  });

  it('2026-07-21 straddles a high and a low too, in a session already running at midnight', () => {
    /*
     * The case ADR 0008 predicted, on a second real day so the first is not a
     * coincidence. The 3.051 ft high at 03:30 and the 1.977 ft low at 08:42 are
     * both inside the band.
     */
    const result = realDay(JULY_21);
    const straddling = result.sessions.find((s) => s.anchors.length === 2);

    expect(straddling, result.reason).toBeDefined();
    expect(straddling!.anchors.map((a) => a.kind)).toEqual(['high', 'low']);
    expect(straddling!.anchors[0]!.ft).toBeCloseTo(3.051, 2);
    expect(straddling!.anchors[1]!.ft).toBeCloseTo(1.977, 2);
  });

  it('2026-07-21 has a session already under way at local midnight', () => {
    // The reason the walk runs over the whole series and intersects with the day
    // afterwards. This session opened the previous evening; reporting it as
    // starting at 00:00 with no flag would be a claim the tide crossed the band
    // edge at midnight.
    const result = realDay(JULY_21);
    const first = result.sessions[0]!;
    expect(first.continuesBefore).toBe(true);
    expect(first.startMs).toBe(pacific(JULY_21, 0));
  });

  it('2026-07-21 ends its second session at 22:36, on a sample reading exactly 1.5', () => {
    /*
     * THE EXACT TIE, and it is real rather than constructed.
     *
     * Of the 3,841 samples in this fixture, exactly one reads `1.5`: 22:36 PDT
     * on 2026-07-21, sitting precisely on the band's lower edge. The band is
     * strict, so that sample is the first one OUT, and the exit crossing
     * interpolates between 22:30 at 1.529 ft and 22:36 at 1.500 ft -- landing on
     * 22:36:00 exactly, because the second point IS the level.
     *
     * A solver using `<=` would carry the session six minutes further and end it
     * at the interpolated crossing between 22:36 and 22:42, which is a different
     * time on the page for a reason nothing in the payload would explain. This
     * is the surf band's version of the tie tidepool's policy.ts documents
     * against the floor.
     */
    const result = realDay(JULY_21);
    const last = result.sessions[result.sessions.length - 1]!;
    expect(last.endMs).toBe(pacific(JULY_21, 22, 36));
  });

  it('a whole fortnight of real days never produces a zero-length session', () => {
    // A run of one sample, or a crossing pair that interpolates backwards, would
    // show up here as a session with no duration. Fifteen consecutive real days
    // is a wider net than any single constructed case.
    for (let day = 13; day <= 27; day++) {
      const result = realDay({ year: 2026, month: 7, day });
      for (const session of result.sessions) {
        expect(session.endMs, `${day} July`).toBeGreaterThan(session.startMs);
      }
    }
  });

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
     */
    // Rises off a 02:30 low, entering the band around 05:09 and leaving it
    // around 07:40. Sunrise at Windansea on 27 July is 05:59, so the session
    // opens in the dark and spends two thirds of itself in daylight.
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
    const rising = result.sessions.find((s) => s.startMs > pacific(TODAY, 2, 30))!;
    expect(rising.startMs).toBeLessThan(result.sunriseMs);
    expect(rising.endMs).toBeGreaterThan(result.sunriseMs);
    expect(sessionLighting(rising, result)).toBe('day');
  });
});
