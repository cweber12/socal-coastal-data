import { describe, expect, it } from 'vitest';

import {
  cellAriaLabel,
  describeFloorGap,
  describeHeight,
  describeWindowLength,
  flagBadgeLabel,
  formatFloorGap,
  formatHeight,
  rowAriaLabel,
  thresholdDisclosure,
} from './labels';
import type { WindowResult, WindowState } from './windows';

const ZONE = 'America/Los_Angeles';

/** A result shaped like a real one, so the label functions can be exercised alone. */
function result(over: Partial<WindowResult> = {}): WindowResult {
  const lowMs = Date.parse('2026-12-24T23:47:00Z'); // 15:47 PST
  return {
    state: 'go',
    date: { year: 2026, month: 12, day: 24 },
    isToday: false,
    daysFromToday: 3,
    lowMs,
    lowFt: -1.878,
    nextHighMs: Date.parse('2026-12-25T06:23:00Z'),
    nextHighFt: 3.8,
    windowStartMs: lowMs - 2 * 3_600_000,
    windowEndMs: lowMs + 3_600_000,
    reachesFloor: true,
    usableStartMs: lowMs - 2 * 3_600_000,
    usableEndMs: lowMs + 3_600_000,
    usableMinutes: 180,
    minutesRemaining: null,
    sunriseMs: Date.parse('2026-12-24T14:48:00Z'),
    sunsetMs: Date.parse('2026-12-25T00:48:00Z'),
    swellFt: 1.2,
    swellKnown: true,
    swellCeilingFt: 3.0,
    floorFt: -0.2,
    windowClipped: false,
    reason: 'Three hours of daylight window with the tide under the floor.',
    ...over,
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
