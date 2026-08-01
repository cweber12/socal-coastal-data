import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The day route's guard, on the same terms as the grid's.
 *
 * This route is the expensive one to leave open: any date inside the servable
 * window is a distinct CO-OPS request, which is why `app/robots.ts` disallows it
 * and why the page sets `index: false, follow: false`. So the assertion that
 * matters is not only that `/kayak/cabrillo-tidepools/2026-07-31` 404s, but that
 * it 404s without loading a day.
 */
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const loadSpotDay = vi.fn(async () => {
  throw new Error('loadSpotDay must not be reached for an unrouted activity');
});

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/activities/tidepool/grid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/activities/tidepool/grid')>()),
  loadSpotDay,
}));

const { default: ActivityDayPage, generateMetadata } = await import('./page');

const render = (activity: string, slug = 'cabrillo-tidepools', date = '2026-07-31') =>
  ActivityDayPage({ params: Promise.resolve({ activity, slug, date }) });

describe('an unknown activity slug', () => {
  it('404s even when the spot and the date are real', async () => {
    notFound.mockClear();
    await expect(render('kayak')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('404s before a day is loaded, so no date becomes a CO-OPS request', async () => {
    loadSpotDay.mockClear();
    await expect(render('surf')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('spot')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadSpotDay).not.toHaveBeenCalled();
  });
});

describe('a routed activity', () => {
  it('renders', async () => {
    notFound.mockClear();
    expect(isValidElement(await render('tidepool'))).toBe(true);
    expect(notFound).not.toHaveBeenCalled();
  });
});

/**
 * Metadata is generated for a request the page then refuses, so the activity is
 * checked in both places. Without the check here, `/kayak/cabrillo-tidepools/...`
 * returns a not-found page whose title names a real spot on a real date -- a
 * page that says it found something while the response says it did not.
 */
describe('generateMetadata', () => {
  it('names the spot and the date under a routed activity', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        activity: 'tidepool',
        slug: 'cabrillo-tidepools',
        date: '2026-07-31',
      }),
    });
    expect(meta.title).toBe('Cabrillo Tidepools, 2026-07-31 — tide chart');
  });

  it('claims nothing under an activity that is not routed', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        activity: 'kayak',
        slug: 'cabrillo-tidepools',
        date: '2026-07-31',
      }),
    });
    expect(meta.title).toBe('Not found');
  });

  it('keeps the day charts out of every index', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({
        activity: 'tidepool',
        slug: 'cabrillo-tidepools',
        date: '2026-07-31',
      }),
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
