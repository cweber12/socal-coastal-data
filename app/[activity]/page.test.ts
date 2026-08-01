import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The grid route's guard: an unknown activity is a 404, and it costs no upstream
 * request.
 *
 * ---------------------------------------------------------------------------
 * What is stubbed, and why the stub is the assertion
 * ---------------------------------------------------------------------------
 *
 * `loadGrid` is the entry point to every fetch this page makes -- CO-OPS
 * predictions for eight spots, NDBC swell, iNaturalist sightings. Replacing it
 * with a spy is what turns "it threw" into the claim actually worth making:
 * that the segment is checked BEFORE anything is fetched, so a crawler walking
 * `/kayak`, `/dive` and `/beach` cannot bill NOAA for pages this app does not
 * have.
 *
 * `notFound()` is stubbed to throw a recognisable error rather than Next's
 * internal digest string. What matters here is that the guard calls it and
 * nothing after it runs; which sentinel Next uses to unwind is Next's business
 * and not something this suite should pin.
 */
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const loadGrid = vi.fn(async () => {
  throw new Error('loadGrid must not be reached for an unrouted activity');
});
const loadSurfGrid = vi.fn(async () => {
  throw new Error('loadSurfGrid must not be reached for an unrouted activity');
});

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/activities/tidepool/grid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/activities/tidepool/grid')>()),
  loadGrid,
}));
/*
 * Both loaders are stubbed, not just tidepool's. A guard that 404s `/kayak`
 * before reaching tidepool's fetches but after reaching surf's would pass a
 * test that only watched the first, and surf's grid fetches predictions for 24
 * spots to tidepool's 8.
 */
vi.mock('@/activities/surf/grid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/activities/surf/grid')>()),
  loadSurfGrid,
}));

const { default: ActivityGridPage, generateStaticParams } = await import('./page');

const render = (activity: string, sort?: string) =>
  ActivityGridPage({
    params: Promise.resolve({ activity }),
    searchParams: Promise.resolve(sort === undefined ? {} : { sort }),
  });

describe('an unknown activity slug', () => {
  it('404s rather than falling back to the activity that does have a grid', async () => {
    notFound.mockClear();
    await expect(render('kayak')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('404s before anything is fetched, by either activity', async () => {
    loadGrid.mockClear();
    loadSurfGrid.mockClear();
    // `dive` and `beach` are named in PRD #101 and are not built. `surf` used to
    // be the example here and is a real page since #129.
    await expect(render('dive')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('beach')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadGrid).not.toHaveBeenCalled();
    expect(loadSurfGrid).not.toHaveBeenCalled();
  });

  it('404s whatever the sort parameter says', async () => {
    await expect(render('kayak', 'geographic')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(render('', 'usable')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('a routed activity', () => {
  it('renders', async () => {
    notFound.mockClear();
    expect(isValidElement(await render('tidepool'))).toBe(true);
    expect(isValidElement(await render('surf'))).toBe(true);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders for either sort order', async () => {
    expect(isValidElement(await render('tidepool', 'geographic'))).toBe(true);
    expect(isValidElement(await render('tidepool', 'nonsense'))).toBe(true);
    expect(isValidElement(await render('surf', 'geographic'))).toBe(true);
    expect(isValidElement(await render('surf', 'nonsense'))).toBe(true);
  });

  /*
   * The claim the switch in page.tsx exists to make, asserted rather than left
   * to the `never` at the end of it: each segment renders ITS OWN grid, not
   * whichever one is listed first.
   *
   * The two components are distinguished by identity, not by output, because
   * rendering either one for real would fetch. That is enough: a fallback would
   * return the same component for both segments and this fails.
   */
  it('renders a different grid for each segment', async () => {
    const tidepool = (await render('tidepool')) as { type: unknown };
    const surf = (await render('surf')) as { type: unknown };
    expect(tidepool.type).not.toBe(surf.type);
  });
});

describe('generateStaticParams', () => {
  it('declares the segments the guard accepts, and no others', async () => {
    const params = generateStaticParams();
    expect(params).toEqual([{ activity: 'tidepool' }, { activity: 'surf' }]);
  });
});
