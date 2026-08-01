import { describe, expect, it } from 'vitest';

import { TIDEPOOL_SLUG, tidepoolDayPath, tidepoolGridPath } from './routes';
import { formatLocalDate, tryParseLocalDate } from '../../core/time';

describe('tidepoolGridPath', () => {
  it('is the activity segment and nothing else', () => {
    expect(tidepoolGridPath()).toBe('/tidepool');
  });

  it('names this activity, so a link from here can never reach another one', () => {
    expect(tidepoolGridPath().split('/')[1]).toBe(TIDEPOOL_SLUG);
  });
});

describe('tidepoolDayPath', () => {
  it('is /<activity>/<slug>/<date>', () => {
    expect(tidepoolDayPath('cabrillo-tidepools', { year: 2026, month: 7, day: 31 })).toBe(
      '/tidepool/cabrillo-tidepools/2026-07-31',
    );
  });

  it('zero-pads, because the route parser accepts YYYY-MM-DD and nothing else', () => {
    expect(tidepoolDayPath('windansea', { year: 2026, month: 1, day: 4 })).toBe(
      '/tidepool/windansea/2026-01-04',
    );
  });

  /*
   * The claim this file exists to keep true: what the builder writes, the route
   * parses back to the same day. `servableDateParam` runs `tryParseLocalDate`
   * over the segment and 404s on null, so a builder that formatted dates its own
   * way would produce links that the route it links to refuses.
   */
  it('round-trips through the parser the route uses', () => {
    for (const date of [
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 7, day: 4 },
      { year: 2026, month: 12, day: 31 },
    ]) {
      const segment = tidepoolDayPath('sunset-cliffs', date).split('/')[3]!;
      expect(tryParseLocalDate(segment)).toEqual(date);
      expect(segment).toBe(formatLocalDate(date));
    }
  });
});
