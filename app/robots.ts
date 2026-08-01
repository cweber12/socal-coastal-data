import type { MetadataRoute } from 'next';

import { ROUTED_ACTIVITIES } from '@/app/activities';

/**
 * Keep crawlers off the day charts.
 *
 * `/<activity>/[slug]/[date]` answers for any date inside the servable window,
 * each one is a distinct CO-OPS request, and every day page links to the day
 * either side of it. Left open that is a chain a crawler walks to both bounds,
 * once per spot, turning ~2,900 dates into ~2,900 upstream fetches for pages
 * nobody searched for. NOAA gets the bill for that, not this app. Every activity
 * routed from here on multiplies the same way, which is why the rule is derived
 * from the registry rather than written once per activity and forgotten on the
 * second.
 *
 * The grids and the eight spot pages stay indexable. They are the pages that
 * answer a question someone might actually type, they are a fixed set, and they
 * do not multiply.
 *
 * `Disallow: /tidepool` + `/` would take the grid itself with it, so the rule
 * needs the trailing slash: `/tidepool/*​/` requires a second path separator,
 * which only the day routes have. `/tidepool` does not match;
 * `/tidepool/cabrillo-tidepools/2026-07-28` does.
 *
 * `/spot/*​/` outlives the route it was written for. #127 moved the day page to
 * `/tidepool/[slug]/[date]` and left `/spot/[slug]/[date]` as a redirect to it,
 * so a crawler that followed the old path would walk the same chain one hop
 * later. It costs nothing to keep and it keeps `/spot/[slug]` -- the facts-first
 * page, which stays where it is -- indexable, since that path has only one
 * separator.
 *
 * robots.txt is a request, not a control. The day route also sets
 * `robots: { index: false, follow: false }` in its metadata for crawlers that
 * do not honour this, and the servable-window check in
 * activities/tidepool/grid.ts is the part that actually holds: past the bound it
 * is a 404 with no upstream request, whatever the client believes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/spot/*/', ...ROUTED_ACTIVITIES.map((activity) => `/${activity}/*/`)],
      },
    ],
  };
}
