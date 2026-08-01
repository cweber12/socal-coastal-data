import { describe, expect, it } from 'vitest';

import {
  cellAriaLabel,
  describeHeight,
  describeSessionCount,
  describeSessionLength,
  flagBadgeLabel,
  formatHeight,
  formatSessionClock,
  rowAriaLabel,
  sessionAnchorLabel,
  sessionAnchorShort,
  thresholdDisclosure,
  unevaluatedAriaLabel,
} from './labels';
import { evaluateSurfDay, type SurfInput } from './policy';
import { SURF_SWELL_MINIMUM, SURF_TIDE_BAND } from './thresholds';
import { MINUS } from '../../core/format';
import { utcMsFromZoned, type LocalDate } from '../../core/time';
import type { TideSeries } from '../../core/feeds/coops-predictions';

const ZONE = 'America/Los_Angeles';
const LAT = 32.832;
const LON = -117.28;
const TODAY: LocalDate = { year: 2026, month: 7, day: 27 };
const BAND = { minFt: SURF_TIDE_BAND.minFt, maxFt: SURF_TIDE_BAND.maxFt };

const pacific = (day: LocalDate, hour: number, minute = 0) =>
  utcMsFromZoned({ ...day, hour, minute }, ZONE);

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
  const STEP = 6 * 60_000;
  const samples: { tMs: number; ft: number }[] = [];
  for (let tMs = points[0]!.tMs; tMs <= points[points.length - 1]!.tMs; tMs += STEP) {
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

const workingDay = () =>
  seriesFromTurns(TODAY, [
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

const flatDay = (ft: number) =>
  seriesFromTurns(TODAY, [
    { hour: 0, ft, dayOffset: -1 },
    { hour: 12, ft, dayOffset: -1 },
    { hour: 12, ft },
    { hour: 12, ft, dayOffset: 1 },
    { hour: 12, ft, dayOffset: 2 },
  ]);

const day = (over: Partial<SurfInput> = {}) =>
  evaluateSurfDay({
    series: workingDay(),
    date: TODAY,
    band: BAND,
    swellCeilingFt: 3.0,
    swellMinimumFt: 1.0,
    currentSwellFt: 2.0,
    // Two days before the day under test: inside the 5-day swell horizon, so
    // the swell is known and a verdict other than `swell-tbd` is reachable, and
    // not `today`, so the session lengths are totals rather than what is left.
    nowMs: pacific({ year: 2026, month: 7, day: 25 }, 8),
    lat: LAT,
    lon: LON,
    timeZone: ZONE,
    ...over,
  });

describe('formatHeight', () => {
  it('uses a true minus sign so a column of heights stays aligned', () => {
    expect(formatHeight(-0.6)).toBe(`${MINUS}0.6`);
    expect(formatHeight(2.5)).toBe('2.5');
  });
});

describe('describeHeight', () => {
  it('says below the datum rather than reading a bare minus aloud', () => {
    expect(describeHeight(-0.6)).toBe('0.6 feet below the datum');
    expect(describeHeight(2.5)).toBe('2.5 feet above the datum');
    expect(describeHeight(0)).toBe('exactly at the datum');
  });
});

describe('sessionAnchorLabel', () => {
  it('names the single turn a session brackets', () => {
    const result = day();
    const aroundALow = result.sessions.find(
      (s) => s.anchors.length === 1 && s.anchors[0]!.kind === 'low',
    );
    expect(aroundALow).toBeDefined();
    expect(sessionAnchorLabel(aroundALow!)).toBe('around the low');
  });

  it('is null for a pass-through, rather than an empty string', () => {
    /*
     * The case that needs a name. A session with no turn inside it is the tide
     * crossing the whole band on one ebb or one flood, and it is common. Null
     * lets the caller decide to print nothing; an empty string would leave a
     * dangling comma in the spoken sentence.
     */
    const passThrough = { anchors: [] } as unknown as Parameters<typeof sessionAnchorLabel>[0];
    expect(sessionAnchorLabel(passThrough)).toBeNull();
  });

  it('names both when the band holds a high and the low next to it', () => {
    const straddling = {
      anchors: [{ kind: 'high' }, { kind: 'low' }],
    } as unknown as Parameters<typeof sessionAnchorLabel>[0];
    expect(sessionAnchorLabel(straddling)).toBe('across a high and a low');
  });
});

describe('describeSessionCount', () => {
  it('counts sessions, singular and plural', () => {
    const one = { sessions: [{}] } as unknown as Parameters<typeof describeSessionCount>[0];
    const two = { sessions: [{}, {}] } as unknown as Parameters<typeof describeSessionCount>[0];
    expect(describeSessionCount(one)).toBe('1 session');
    expect(describeSessionCount(two)).toBe('2 sessions');
  });

  it('says no session rather than "0 sessions"', () => {
    const none = { sessions: [] } as unknown as Parameters<typeof describeSessionCount>[0];
    expect(describeSessionCount(none)).toBe('no session in the band');
  });
});

describe('describeSessionLength', () => {
  it('gives time left on today and total length on any other day', () => {
    const session = { usableMinutes: 150, minutesRemaining: 42 } as never;
    expect(describeSessionLength(session, true)).toMatch(/left$/);
    expect(describeSessionLength(session, false)).not.toMatch(/left$/);
  });
});

describe('formatSessionClock', () => {
  it('keeps both meridiems when the session straddles noon', () => {
    const session = { startMs: pacific(TODAY, 10, 5), endMs: pacific(TODAY, 13, 20) } as never;
    expect(formatSessionClock(session, ZONE)).toBe('10:05 am–1:20 pm');
  });

  it('drops the redundant meridiem when both ends share one', () => {
    // Three characters and a space, on roughly four sessions in five. The grid
    // has about 151 units per day column and a range needs more than an instant
    // does; the first render pushed the last two columns off the page.
    const session = { startMs: pacific(TODAY, 13, 32), endMs: pacific(TODAY, 19, 23) } as never;
    expect(formatSessionClock(session, ZONE)).toBe('1:32–7:23 pm');
  });

  it('drops it for a morning session too', () => {
    const session = { startMs: pacific(TODAY, 7, 47), endMs: pacific(TODAY, 9, 42) } as never;
    expect(formatSessionClock(session, ZONE)).toBe('7:47–9:42 am');
  });
});

describe('sessionAnchorShort', () => {
  it('is one word for one turn, and null for a pass-through', () => {
    const low = { anchors: [{ kind: 'low' }] } as never;
    const high = { anchors: [{ kind: 'high' }] } as never;
    const none = { anchors: [] } as never;
    expect(sessionAnchorShort(low)).toBe('low');
    expect(sessionAnchorShort(high)).toBe('high');
    expect(sessionAnchorShort(none)).toBeNull();
  });

  it('names both when the band holds a high and the low next to it', () => {
    const both = { anchors: [{ kind: 'high' }, { kind: 'low' }] } as never;
    expect(sessionAnchorShort(both)).toBe('high + low');
  });

  it('is shorter than the spoken form, which stays prose', () => {
    // The cell face is on a width budget; a spoken sentence is not, and "low" is
    // not a sentence.
    const low = { anchors: [{ kind: 'low' }] } as never;
    expect(sessionAnchorShort(low)!.length).toBeLessThan(sessionAnchorLabel(low)!.length);
    expect(sessionAnchorLabel(low)).toBe('around the low');
  });
});

describe('cellAriaLabel', () => {
  it('leads with the spot, the day and the state in words', () => {
    const result = day();
    const label = cellAriaLabel('Windansea', result, ZONE);
    expect(label.startsWith('Windansea, ')).toBe(true);
    expect(label).toMatch(/: go\./);
  });

  it('counts the sessions before enumerating them', () => {
    /*
     * The difference from a tidepool cell, and the reason this file exists. A
     * listener given four unheralded clock ranges cannot tell how many are
     * coming; a sentence that says "2 sessions" first is one they can decide to
     * stop listening to.
     */
    const label = cellAriaLabel('Windansea', day(), ZONE);
    const countAt = label.search(/\d+ sessions?|no session/);
    const firstClockAt = label.search(/\d+:\d\d/);
    expect(countAt).toBeGreaterThan(-1);
    expect(countAt).toBeLessThan(firstClockAt);
  });

  it('speaks the lighting, which the cell only shows with a background', () => {
    const label = cellAriaLabel('Windansea', day(), ZONE);
    expect(label).toMatch(/in daylight|after dark/);
  });

  it('does not repeat the day range on an out-of-band cell', () => {
    // 22 of 24 rows on a flat week. The reason already gives both numbers
    // against the band, and saying them twice in every cell is the noise this
    // avoids.
    const result = day({ series: flatDay(5.0) });
    const label = cellAriaLabel('Windansea', result, ZONE);
    expect(result.state).toBe('out-of-band');
    expect(label).toContain(result.reason);
    expect(label).not.toMatch(/sessions? in the/);
  });

  it('always ends by saying the cell is selectable', () => {
    for (const result of [day(), day({ series: flatDay(5.0) })]) {
      expect(cellAriaLabel('Windansea', result, ZONE).endsWith('Select for the day chart.')).toBe(
        true,
      );
    }
  });

  it('carries the whole reason, so the verdict is never visual-only', () => {
    const result = day({ currentSwellFt: 0.4 });
    expect(cellAriaLabel('Windansea', result, ZONE)).toContain(result.reason);
  });
});

describe('flagBadgeLabel', () => {
  it('names the cell without repeating the verdict', () => {
    const result = day();
    const label = flagBadgeLabel('Windansea', result, ZONE);
    expect(label).toMatch(/^Why this reading/);
    expect(label).toContain('Windansea');
    // The cell's own aria-label already speaks the state; a badge that repeated
    // it would make every cell announce its verdict twice.
    expect(label).not.toMatch(/\bgo\b/);
  });
});

describe('unevaluatedAriaLabel', () => {
  it('says unknown rather than unusable', () => {
    const label = unevaluatedAriaLabel('Windansea', TODAY, ZONE, pacific(TODAY, 12));
    expect(label).toMatch(/unknown rather than unusable/);
  });
});

describe('rowAriaLabel', () => {
  it('says none, one and many in words', () => {
    expect(rowAriaLabel('Windansea', 0, 7)).toMatch(/no usable days/);
    expect(rowAriaLabel('Windansea', 1, 7)).toMatch(/1 usable day\b/);
    expect(rowAriaLabel('Windansea', 3, 7)).toMatch(/3 usable days/);
  });
});

describe('thresholdDisclosure', () => {
  it('names all three uncalibrated numbers and the missing measured fact', () => {
    /*
     * Tidepool's equivalent names two, and its floor is at least a measured zone
     * fact with an instrument path behind it. Nothing on a surf page has one,
     * and the sentence has to say so rather than let a reader infer that surf is
     * as well-founded as the grid next to it.
     */
    const text = thresholdDisclosure(
      BAND,
      SURF_TIDE_BAND.confidence,
      3.0,
      'uncalibrated',
      SURF_SWELL_MINIMUM.ft,
      SURF_SWELL_MINIMUM.confidence,
    );
    expect(text).toMatch(/1\.5–3\.5 ft/);
    expect(text).toMatch(/uncalibrated/);
    expect(text).toMatch(/field-checked/);
    expect(text).toMatch(/no measured fact/);
  });

  it('states one confidence for the swell window when both ends agree', () => {
    // "(uncalibrated/uncalibrated)" made a reader work out which half was which
    // to learn that both halves said the same thing.
    const text = thresholdDisclosure(BAND, 'uncalibrated', 3.0, 'uncalibrated', 1.0, 'uncalibrated');
    expect(text).toMatch(/swell 1\.0–3\.0 ft \(uncalibrated\)/);
    expect(text).not.toMatch(/uncalibrated\/uncalibrated/);
  });

  it('keeps them apart the moment one end is promoted', () => {
    const text = thresholdDisclosure(BAND, 'uncalibrated', 3.0, 'calibrated', 1.0, 'uncalibrated');
    expect(text).toMatch(/uncalibrated minimum, calibrated ceiling/);
  });
});
