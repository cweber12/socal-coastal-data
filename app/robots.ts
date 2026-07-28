import type { MetadataRoute } from 'next';

/**
 * Keep crawlers off the day charts.
 *
 * `/spot/[slug]/[date]` answers for any date inside the servable window, each
 * one is a distinct CO-OPS request, and every day page links to the day either
 * side of it. Left open that is a chain a crawler walks to both bounds, once
 * per spot, turning ~2,900 dates into ~2,900 upstream fetches for pages nobody
 * searched for. NOAA gets the bill for that, not this app.
 *
 * The grid and the eight spot pages stay indexable. They are the pages that
 * answer a question someone might actually type, they are a fixed set, and they
 * do not multiply.
 *
 * `Disallow: /spot/*` + `/` would take the spot pages with it, so the rule needs
 * the trailing slash: `/spot/*​/` requires a second path separator, which only
 * the day routes have. `/spot/cabrillo-tidepools` does not match;
 * `/spot/cabrillo-tidepools/2026-07-28` does.
 *
 * robots.txt is a request, not a control. The day route also sets
 * `robots: { index: false, follow: false }` in its metadata for crawlers that
 * do not honour this, and the servable-window check in lib/grid.ts is the part
 * that actually holds: past the bound it is a 404 with no upstream request,
 * whatever the client believes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/spot/*/'],
      },
    ],
  };
}
