import { describe, expect, it } from 'vitest';

import {
  cellAriaLabel,
  describeFloorGap,
  describeHeight,
  describeSighting,
  describeWindowLength,
  flagBadgeLabel,
  formatFloorGap,
  formatHeight,
  formatSightingTide,
  rowAriaLabel,
  thresholdDisclosure,
} from './labels';
import type { WindowResult } from './policy';
import type { UsableWindow } from '../../core/window/day';
import type { WindowState } from './states';
import { parseCoopsSeries, type TideSeries } from '../../core/feeds/coops-predictions';
import { parseInatObservations, INAT_RADIUS_KM } from '../../core/feeds/inat-observations';
import { annotateWithTide } from '../../core/sightings';
import coops384h from '../../core/feeds/__fixtures__/coops-9410230-20260713-384h.json';
import sunsetCliffs from '../../core/feeds/__fixtures__/inat-sunset-cliffs-20260728.json';

/*
 * The same captured payloads the sightings join is tested against, because
 * describeSighting's sentences are asserted against real observation
 * timestamps rather than round numbers chosen to make interpolation easy.
 */
const SERIES: TideSeries = parseCoopsSeries(coops384h, {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
});

const OBSERVATIONS = parseInatObservations(sunsetCliffs, {
  spotSlug: 'sunset-cliffs',
  lat: 32.723,
  lon: -117.256,
  radiusKm: INAT_RADIUS_KM,
  windowStart: { year: 2026, month: 7, day: 14 },
  qualityGrade: 'research',
});

const ZONE = 'America/Los_Angeles';

/**
 * A result shaped like a real one, so the label functions can be exercised
 * alone.
 *
 * The overrides stay FLAT -- `lowFt`, `usableMinutes`, `reachesFloor` -- rather
 * than mirroring the nested shape #130 introduced. A fixture builder's job is to
 * make a case readable at its call site, and `{ reachesFloor: false, lowFt: 2.4 }`
 * says what the case is where `{ detail: { window: null, lowFt: 2.4, ... } }`
 * would say how the type is arranged.
 *
 * `reachesFloor: false` builds a result with NO window, which is what
 * `above-floor` now is.
 */
interface ResultOverrides {
  state?: WindowState;
  isToday?: boolean;
  daysFromToday?: number;
  sunriseMs?: number;
  sunsetMs?: number;
  reason?: string;
  lowMs?: number;
  lowFt?: number;
  nextHighMs?: number | null;
  nextHighFt?: number | null;
  reachesFloor?: boolean;
  floorFt?: number;
  usableMinutes?: number;
  minutesRemaining?: number | null;
}

function result(over: ResultOverrides = {}): WindowResult {
  const lowMs = over.lowMs ?? Date.parse('2026-12-24T23:47:00Z'); // 15:47 PST
  const reachesFloor = over.reachesFloor ?? true;
  const window: UsableWindow | null = reachesFloor
    ? {
        startMs: lowMs - 2 * 3_600_000,
        endMs: lowMs + 3_600_000,
        continuesBefore: false,
        continuesAfter: false,
        seriesClipped: false,
        anchors: [],
        usableStartMs: lowMs - 2 * 3_600_000,
        usableEndMs: lowMs + 3_600_000,
        usableMinutes: over.usableMinutes ?? 180,
        minutesRemaining: over.minutesRemaining ?? null,
        gateBlocked: false,
      }
    : null;

  return {
    state: over.state ?? 'go',
    date: { year: 2026, month: 12, day: 24 },
    isToday: over.isToday ?? false,
    daysFromToday: over.daysFromToday ?? 3,
    windows: window ? [window] : [],
    sunriseMs: over.sunriseMs ?? Date.parse('2026-12-24T14:48:00Z'),
    sunsetMs: over.sunsetMs ?? Date.parse('2026-12-25T00:48:00Z'),
    swellFt: 1.2,
    swellKnown: true,
    swellCeilingFt: 3.0,
    swellMinimumFt: null,
    reason: over.reason ?? 'Three hours of daylight window with the tide under the floor.',
    disclosures: [],
    detail: {
      window,
      lowMs,
      lowFt: over.lowFt ?? -1.878,
      nextHighMs: over.nextHighMs === undefined ? Date.parse('2026-12-25T06:23:00Z') : over.nextHighMs,
      nextHighFt: over.nextHighFt === undefined ? 3.8 : over.nextHighFt,
      reachesFloor,
      floorFt: over.floorFt ?? -0.2,
    },
  };
}

describe('formatHeight', () => {
  it('uses a true minus sign, not a hyphen', () => {
    // U+2212 aligns with digits in a tabular-numbers column; a hyphen does not.
    expect(formatHeight(-0.6)).toBe('−0.6');
    expect(formatHeight(-1.878)).toBe('−1.9');
    expect(formatHeight(3.8)).toBe('3.8');
    expect(formatHeight(0)).toBe('0.0');
  });
});

describe('describeHeight', () => {
  it('says below the datum rather than reading out a minus sign', () => {
    // A screen reader renders "-0.6" as "minus nought point six", which tells the
    // listener nothing about whether the reef is exposed.
    expect(describeHeight(-0.6)).toBe('0.6 feet below the datum');
    expect(describeHeight(3.8)).toBe('3.8 feet above the datum');
    expect(describeHeight(0)).toBe('exactly at the datum');
  });
});

describe('cellAriaLabel', () => {
  it('reads as a whole sentence naming the state in words', () => {
    const label = cellAriaLabel('Cabrillo Tidepools', result(), ZONE);
    expect(label).toBe(
      'Cabrillo Tidepools, Thursday, December 24: go. ' +
        'Low 1.9 feet below the datum at 3:47 pm, in daylight, 1.7 feet under the floor. ' +
        'Next high 3.8 feet above the datum at 10:23 pm. ' +
        '3 h of daylight window. ' +
        'Three hours of daylight window with the tide under the floor. ' +
        'Select for the day chart.',
    );
  });

  it('speaks the lighting the cell background shows', () => {
    // The background is light or dark and says nothing else. Two cells differing
    // only in that would be identical to a listener if this were left out.
    const sunriseMs = Date.parse('2026-12-24T14:48:00Z');
    const sunsetMs = Date.parse('2026-12-25T00:48:00Z');

    expect(cellAriaLabel('X', result(), ZONE)).toContain('at 3:47 pm, in daylight,');

    // 05:12 PST, an hour and a half before sunrise.
    const beforeDawn = Date.parse('2026-12-24T13:12:00Z');
    expect(
      cellAriaLabel('X', result({ lowMs: beforeDawn, sunriseMs, sunsetMs }), ZONE),
    ).toContain('at 5:12 am, after dark,');
  });

  it('never leans on colour, which a screen reader cannot see', () => {
    for (const state of ['go', 'brief', 'veto', 'dark', 'above-floor', 'swell-tbd'] as WindowState[]) {
      const label = cellAriaLabel('Swami’s', result({ state }), ZONE);
      expect(label.toLowerCase()).not.toContain('green');
      expect(label.toLowerCase()).not.toContain('red');
      expect(label.toLowerCase()).not.toContain('colour');
    }
  });

  it('names every state in words', () => {
    const spoken: Record<WindowState, string> = {
      go: 'go',
      brief: 'brief',
      veto: 'vetoed on swell',
      closed: 'outside gate hours',
      dark: 'outside daylight',
      'above-floor': 'above the floor',
      'swell-tbd': 'swell unknown',
    };
    for (const [state, word] of Object.entries(spoken)) {
      expect(cellAriaLabel('X', result({ state: state as WindowState }), ZONE)).toContain(
        `: ${word}.`,
      );
    }
  });

  it('says "today" rather than the date when the day is today', () => {
    // A cell has no context once focus lands on it, so it always names its day --
    // but "today" is more useful than the date when that is what it is.
    const label = cellAriaLabel('Cabrillo Tidepools', result({ isToday: true, minutesRemaining: 42 }), ZONE);
    expect(label).toContain('Cabrillo Tidepools, today: go.');
    expect(label).toContain('42 min of window left');
  });

  it('omits the next high when the series ends before one', () => {
    const label = cellAriaLabel('X', result({ nextHighMs: null, nextHighFt: null }), ZONE);
    expect(label).not.toContain('Next high');
    expect(label).toContain('Low 1.9 feet below the datum');
  });

  it('does not quote a window length for states that have no window', () => {
    for (const state of ['above-floor', 'dark', 'veto'] as WindowState[]) {
      expect(cellAriaLabel('X', result({ state }), ZONE)).not.toContain('daylight window.');
    }
  });
});

describe('flagBadgeLabel', () => {
  it('names the cell without repeating the verdict', () => {
    // The cell's own label already spoke the state in full. A badge that said it
    // again would make every cell in the grid announce its state twice.
    const label = flagBadgeLabel('Cabrillo Tidepools', result({ state: 'veto' }), ZONE);
    expect(label).toBe('Why this reading — Cabrillo Tidepools, Thursday, December 24');
    expect(label.toLowerCase()).not.toContain('swell');
    expect(label.toLowerCase()).not.toContain('veto');
  });

  it('says today rather than the date when the day is today', () => {
    expect(flagBadgeLabel('X', result({ isToday: true }), ZONE)).toBe('Why this reading — X, today');
  });
});

describe('describeWindowLength', () => {
  it('counts from now for today and gives the whole window otherwise', () => {
    expect(describeWindowLength(result({ isToday: true, minutesRemaining: 96 }))).toBe(
      '1 h 36 min of window left',
    );
    expect(describeWindowLength(result({ isToday: false, usableMinutes: 96 }))).toBe(
      '1 h 36 min of daylight window',
    );
  });
});

describe('rowAriaLabel', () => {
  it('pluralises and says zero rather than omitting it', () => {
    expect(rowAriaLabel('Swami’s', 0, 7)).toContain('no usable windows in the next 7 days');
    expect(rowAriaLabel('Swami’s', 1, 7)).toContain('1 usable window in the next 7 days');
    expect(rowAriaLabel('Swami’s', 3, 7)).toContain('3 usable windows in the next 7 days');
  });
});

describe('thresholdDisclosure', () => {
  it('states both thresholds and that neither is field-checked', () => {
    // Both the floor and the ceiling are author estimates, and spots.json flags
    // Sunset Cliffs as a place where a wrong floor strands people. The disclosure
    // is not boilerplate.
    expect(thresholdDisclosure(-0.8, 'low', 3.0, 'uncalibrated')).toBe(
      'Floor −0.8 ft (low), swell ceiling 3.0 ft (uncalibrated). Neither has been field-checked.',
    );
  });
});

describe('formatFloorGap', () => {
  it('signs a low that gets under the floor negative', () => {
    // Negative means the tide went BELOW the floor, which uncovers reef. The
    // sign follows the tide, not the verdict, so it agrees with the ▼ and with
    // heights below the datum already printing negative.
    expect(formatFloorGap(-0.5, 1.3)).toBe('−1.8');
  });

  it('signs a low that stays over the floor positive, explicitly', () => {
    // The + is not decoration. Without it the positive values are a glyph
    // narrower than the negative ones and a column of gaps combs down the grid.
    expect(formatFloorGap(2.4, 1.3)).toBe('+1.1');
  });

  it('uses a true minus sign, not a hyphen', () => {
    expect(formatFloorGap(0, 1)).toBe('−1.0');
    expect(formatFloorGap(0, 1).startsWith('-')).toBe(false);
  });

  it('does not render a negative zero as under the floor', () => {
    // -0.04 rounds to "-0.0" through toFixed, which reads as under-floor when
    // the tide is actually at or fractionally above it. Unsigned instead.
    expect(formatFloorGap(1.26, 1.3)).toBe('0.0');
  });

  it('signs neither direction when the low is at the floor', () => {
    // Both signs are false here. +0.0 claims the low is over the floor and −0.0
    // claims it is under; unsigned says the two agree to the precision shown.
    expect(formatFloorGap(1.3, 1.3)).toBe('0.0');
    expect(formatFloorGap(0.9, 0.9)).toBe('0.0');
  });
});

describe('describeFloorGap', () => {
  it('speaks the gap when the tide reaches the floor', () => {
    // No reason string carries the floor number for these states, so this is
    // the only place a listener gets it.
    expect(describeFloorGap(result({ reachesFloor: true, lowFt: -1.9, floorFt: -0.2 }))).toBe(
      '1.7 feet under the floor',
    );
  });

  it('stays silent when the low is above the floor', () => {
    // `above-floor` is 49 of 56 cells in a typical week here, and its reason
    // already states both numbers -- "only reaches 2.4 ft, which does not get
    // under the 1.3 ft floor". Speaking the subtraction as well would make
    // every covered cell announce the same fact twice.
    expect(describeFloorGap(result({ reachesFloor: false, lowFt: 2.4, floorFt: 1.3 }))).toBeNull();
  });

  it('is carried inside the low sentence of a cell label, not as its own', () => {
    const label = cellAriaLabel('Windansea', result({ reachesFloor: true, floorFt: -0.2 }), ZONE);
    expect(label).toContain('feet under the floor.');
    // One mention only.
    expect(label.match(/feet under the floor/g)).toHaveLength(1);
  });

  it('does not add a second floor mention to an above-floor cell', () => {
    const label = cellAriaLabel(
      'Cabrillo Tidepools',
      result({
        state: 'above-floor',
        reachesFloor: false,
        lowFt: 2.4,
        floorFt: 1.3,
        reason: 'The next low only reaches 2.4 ft, which does not get under the 1.3 ft floor.',
      }),
      ZONE,
    );
    // 'above the floor' (the spoken state) and the reason both say floor, and
    // both predate this. What must NOT appear is the gap phrasing on top.
    expect(label).not.toContain('feet under the floor');
  });
});

/* ===========================================================================
 * The sentences a reader and a screen reader get
 * ========================================================================= */

describe('formatSightingTide', () => {
  const tide = (heightFt: number, minutesFromLow: number) => ({
    heightFt,
    minutesFromLow,
    lowMs: 0,
    lowFt: -0.5,
  });

  it('reads as prose with the height and the distance from the low', () => {
    expect(formatSightingTide(tide(0.4, 40))).toBe('0.4 ft, 40 min after the low');
    expect(formatSightingTide(tide(1.2, -25))).toBe('1.2 ft, 25 min before the low');
  });

  it('uses a true minus sign for a height below the datum', () => {
    // U+2212, the same one the grid cells use, so a column of these aligns.
    expect(formatSightingTide(tide(-0.6, 10))).toBe('−0.6 ft, 10 min after the low');
  });

  it('says "at the low" rather than claiming minutes the extremum time does not have', () => {
    // findExtrema places a turn within about 60 s of NOAA's own answer, up to
    // 30 s of which is NOAA's whole-minute rounding.
    expect(formatSightingTide(tide(-0.4, 0))).toBe('−0.4 ft, at the low');
    expect(formatSightingTide(tide(-0.4, 2))).toBe('−0.4 ft, at the low');
    expect(formatSightingTide(tide(-0.4, -2))).toBe('−0.4 ft, at the low');
  });

  it('rounds to five minutes', () => {
    expect(formatSightingTide(tide(0.4, 37))).toBe('0.4 ft, 35 min after the low');
    expect(formatSightingTide(tide(0.4, 38))).toBe('0.4 ft, 40 min after the low');
  });

  it('reads hours past an hour', () => {
    expect(formatSightingTide(tide(2.0, 95))).toBe('2.0 ft, 1 h 35 min after the low');
  });
});

describe('describeSighting', () => {
  const annotated = annotateWithTide(OBSERVATIONS.sightings, SERIES);

  it('carries everything the photo conveys visually, plus the tide', () => {
    const sentence = describeSighting(annotated[0]!, 'America/Los_Angeles');
    expect(sentence).toContain('American Crow (Corvus brachyrhynchos)');
    expect(sentence).toContain('July 24');
    expect(sentence).toContain('12:01 pm');
    expect(sentence).toContain('morgan');
    expect(sentence).toMatch(/Predicted tide .* (above|below) the datum/);
  });

  it('speaks a height rather than a bare negative', () => {
    // "minus nought point six" tells a listener nothing about whether reef is
    // showing. Same rule describeHeight already applies to the grid.
    const s = describeSighting(
      { ...annotated[0]!, tide: { heightFt: -0.6, minutesFromLow: 0, lowMs: 0, lowFt: -0.6 } },
      'America/Los_Angeles',
    );
    expect(s).toContain('0.6 feet below the datum');
    expect(s).not.toContain('-0.6');
  });

  it('does not double the full stop after a name ending in an initial', () => {
    // "Heidi H." is a real observer in the fixture, and "by Heidi H.." reads
    // back as "Heidi H dot dot".
    const s = describeSighting(
      { ...annotated[0]!, observerName: 'Heidi H.' },
      'America/Los_Angeles',
    );
    expect(s).toContain('by Heidi H. ');
    expect(s).not.toContain('..');
  });

  it('says why a photo is absent', () => {
    const withheld = annotated.find((s) => s.photo === null)!;
    expect(describeSighting(withheld, 'America/Los_Angeles')).toContain(
      'No photo shown: All Rights Reserved.',
    );
  });

  it('says the time was not stated rather than inventing one', () => {
    const s = describeSighting(
      {
        ...annotated[0]!,
        observedAtMs: null,
        tide: null,
        tideUnavailableReason: 'this observation records a date but no time',
      },
      'America/Los_Angeles',
    );
    expect(s).toContain('time not stated');
    expect(s).toContain('No tide height: this observation records a date but no time.');
  });
});
