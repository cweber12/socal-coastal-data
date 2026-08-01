import { describe, expect, it } from 'vitest';

import { SURF_SLUG, surfDayPath, surfGridPath } from './routes';
import { formatLocalDate, tryParseLocalDate } from '../../core/time';

describe('surfGridPath', () => {
  it('is the activity segment and nothing else', () => {
    expect(surfGridPath()).toBe('/surf');
  });

  it('names this activity, so a link from here can never reach another one', () => {
    expect(surfGridPath().split('/')[1]).toBe(SURF_SLUG);
  });
});

describe('surfDayPath', () => {
  it('is /<activity>/<slug>/<date>', () => {
    expect(surfDayPath('windansea', { year: 2026, month: 7, day: 31 })).toBe(
      '/surf/windansea/2026-07-31',
    );
  });

  it('zero-pads, because the route parser accepts YYYY-MM-DD and nothing else', () => {
    expect(surfDayPath('tourmaline', { year: 2026, month: 1, day: 4 })).toBe(
      '/surf/tourmaline/2026-01-04',
    );
  });

  it('round-trips through the parser the route uses', () => {
    for (const date of [
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 7, day: 4 },
      { year: 2026, month: 12, day: 31 },
    ]) {
      const segment = surfDayPath('blacks-beach', date).split('/')[3]!;
      expect(tryParseLocalDate(segment)).toEqual(date);
      expect(segment).toBe(formatLocalDate(date));
    }
  });
});

describe('the two activities cannot collide', () => {
  /*
   * The failure #127 built the segment for, now that there is something to
   * collide with. Every surf link must begin `/surf`, and this file is the only
   * place that string is written down on this side of the boundary --
   * scripts/check-boundaries.mjs makes it impossible for this module to reach
   * tidepool's, so the two cannot be accidentally unified into one constant
   * either.
   */
  it('every path this module builds is under its own segment', () => {
    const paths = [surfGridPath(), surfDayPath('windansea', { year: 2026, month: 7, day: 31 })];
    for (const path of paths) {
      expect(path.startsWith(`/${SURF_SLUG}`)).toBe(true);
      expect(path.startsWith('/tidepool')).toBe(false);
    }
  });
});
