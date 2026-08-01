import { describe, expect, it } from 'vitest';

import { ROUTED_ACTIVITIES, routedActivity } from './activities';
import robots from './robots';
import { SURF_SLUG, surfGridPath } from '@/activities/surf/routes';
import { TIDEPOOL_SLUG, tidepoolGridPath } from '@/activities/tidepool/routes';
import nextConfig from '../next.config';

describe('routedActivity', () => {
  it('resolves each activity that has a grid', () => {
    expect(routedActivity('tidepool')).toBe(TIDEPOOL_SLUG);
    expect(routedActivity('surf')).toBe(SURF_SLUG);
  });

  /*
   * The case this registry exists for.
   *
   * It used to be argued with `surf`, which had a directory from #128 -- two
   * per-spot swell ceilings and a reader for them, with its caveats rendered on
   * every page -- and no predicate, no grid and nothing to answer `/surf` with.
   * #129 built those and surf joined the registry in the same commit, which is
   * the rule the registry states: a slug enters this list in the PR that gives
   * it something to render.
   *
   * `dive` and `beach` carry the argument now. Both are named in PRD #101,
   * neither is built, and a registry derived from the filesystem would route
   * whichever of them acquires a directory first -- serving another activity's
   * verdicts under a URL that names it, which is the same class of failure as a
   * null rendering as a pass.
   */
  it('refuses an activity that is planned but not built', () => {
    expect(routedActivity('dive')).toBeNull();
    expect(routedActivity('beach')).toBeNull();
  });

  it('refuses anything else, exactly rather than approximately', () => {
    for (const segment of [
      'kayak',
      'Tidepool',
      'TIDEPOOL',
      'tidepools',
      ' tidepool',
      'tidepool ',
      'tide-pool',
      'Surf',
      'surfing',
      'surfs',
      '',
      'spot',
      'robots.txt',
    ]) {
      expect(routedActivity(segment), segment).toBeNull();
    }
  });

  /*
   * `includes` on an array of slugs would answer true for anything Array.prototype
   * finds, and nothing else -- but the guard is the only thing between a URL and
   * a render, so the shape of what it accepts is worth pinning rather than
   * assuming.
   */
  it('is not fooled by a property name that is not a slug', () => {
    for (const segment of ['constructor', 'toString', '__proto__', 'length', '0']) {
      expect(routedActivity(segment), segment).toBeNull();
    }
  });
});

describe('ROUTED_ACTIVITIES', () => {
  it('is not empty, since every route under [activity] would 404', () => {
    expect(ROUTED_ACTIVITIES.length).toBeGreaterThan(0);
  });

  it('has no duplicates', () => {
    expect(new Set(ROUTED_ACTIVITIES).size).toBe(ROUTED_ACTIVITIES.length);
  });

  /*
   * A slug that needs escaping is a slug whose route segment and whose registry
   * key are different strings, which is how a link and a guard start disagreeing.
   */
  it('holds slugs that survive being a URL segment unchanged', () => {
    for (const activity of ROUTED_ACTIVITIES) {
      expect(encodeURIComponent(activity), activity).toBe(activity);
      expect(activity, activity).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  /*
   * Each activity declares its own segment in its own directory, because
   * scripts/check-boundaries.mjs forbids either from importing the other's. That
   * makes two independent string literals which must not collide -- and a
   * collision would be a URL serving one activity's verdicts under the other's
   * name, which is the failure #127 built the segment for.
   */
  it('gives each activity a distinct grid path', () => {
    expect(tidepoolGridPath()).not.toBe(surfGridPath());
    expect(new Set([TIDEPOOL_SLUG, SURF_SLUG]).size).toBe(2);
  });

  it('has no slug that is a path prefix of another', () => {
    // `/surf` and `/surfing` would both match a prefix rule in robots.txt, and
    // the day-page disallow patterns are built by prefix.
    for (const a of ROUTED_ACTIVITIES) {
      for (const b of ROUTED_ACTIVITIES) {
        if (a === b) continue;
        expect(a.startsWith(b), `${a} starts with ${b}`).toBe(false);
      }
    }
  });
});

/**
 * A redirect whose destination is not a routed activity sends readers to a 404,
 * which is a worse outcome than the broken link it was added to avoid. The
 * config builds its destinations from `tidepoolGridPath()` rather than writing
 * `/tidepool` out again, so that cannot happen by a rename -- this is what keeps
 * it from happening by a hand-typed destination either.
 */
describe('the redirects that carry the paths #127 moved', () => {
  const redirects = async () => {
    const rules = await nextConfig.redirects!();
    return rules as { source: string; destination: string; permanent: boolean }[];
  };

  it('sends the root to the grid of a routed activity', async () => {
    const root = (await redirects()).find((r) => r.source === '/');
    expect(root).toBeDefined();
    expect(root!.destination).toBe(tidepoolGridPath());
  });

  it('sends the old day path under a routed activity, keeping both parameters', async () => {
    const day = (await redirects()).find((r) => r.source === '/spot/:slug/:date');
    expect(day).toBeDefined();
    expect(day!.destination).toBe(`${tidepoolGridPath()}/:slug/:date`);
  });

  it('names a routed activity in every destination', async () => {
    for (const rule of await redirects()) {
      const first = rule.destination.split('/')[1] ?? '';
      expect(routedActivity(first), rule.destination).not.toBeNull();
    }
  });

  /*
   * 308s are cached by browsers with no revalidation and no expiry. `/` stops
   * being a redirect when #101's corridor overview lands, and `/spot/:slug/:date`
   * is contingent on #133 -- neither is a claim that can be taken back from a
   * reader who has already followed it once.
   */
  it('makes no permanent claim, because neither destination is permanent', async () => {
    for (const rule of await redirects()) {
      expect(rule.permanent, rule.source).toBe(false);
    }
  });
});

/**
 * The day route multiplies: any date inside the servable window is a distinct
 * CO-OPS request, and every day page links to the day either side of it. One
 * activity's worth of that was the reason for the original rule; the rule is now
 * derived so the second activity cannot be the one that gets forgotten.
 */
describe('robots.txt', () => {
  const rule = () => {
    const rules = robots().rules;
    const all = Array.isArray(rules) ? rules : [rules];
    // One group covering every crawler. If that ever becomes several, this test
    // is reading the wrong one and should say so rather than pass on the first.
    expect(all).toHaveLength(1);
    return all[0] as { allow?: string; disallow?: string[] };
  };

  it('keeps crawlers off every routed activity’s day pages', () => {
    for (const activity of ROUTED_ACTIVITIES) {
      expect(rule().disallow).toContain(`/${activity}/*/`);
    }
  });

  it('still covers the pre-#127 day path, which is now a redirect to the same page', () => {
    expect(rule().disallow).toContain('/spot/*/');
  });

  /*
   * The trailing slash is the whole rule, and it is the part a reader of the file
   * has to take on trust. A crawler matches a pattern as a prefix with `*` free
   * to stand for anything, so `/tidepool/*​/` needs a second separator to match --
   * which only the day routes have. Written without it, the same rule would take
   * the grid and the eight spot pages out of every index.
   */
  const disallows = (path: string) =>
    (rule().disallow ?? []).some((pattern) =>
      new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}`).test(path),
    );

  it('disallows a day page under a routed activity', () => {
    expect(disallows('/tidepool/cabrillo-tidepools/2026-07-31')).toBe(true);
    expect(disallows('/surf/windansea/2026-07-31')).toBe(true);
  });

  it('disallows a day page at the path it was moved from', () => {
    expect(disallows('/spot/cabrillo-tidepools/2026-07-31')).toBe(true);
  });

  it('leaves the grid, the spot pages and the root indexable', () => {
    expect(disallows('/tidepool')).toBe(false);
    expect(disallows('/tidepool?sort=geographic')).toBe(false);
    expect(disallows('/surf')).toBe(false);
    expect(disallows('/surf?sort=geographic')).toBe(false);
    expect(disallows('/spot/windansea')).toBe(false);
    expect(disallows('/')).toBe(false);
    expect(rule().allow).toBe('/');
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
