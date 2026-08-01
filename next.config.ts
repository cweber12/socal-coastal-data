import type { NextConfig } from 'next';

import { tidepoolGridPath } from './activities/tidepool/routes';

/**
 * TypeScript, as of #127, and for one reason: so the redirect below can name the
 * activity it forwards to by importing it rather than by repeating it.
 *
 * `/tidepool` is written once in this repo, in `activities/tidepool/routes.ts`,
 * and everything that builds a link to that activity reads it from there. A
 * config that spelled it out again would be the one place a rename could leave
 * behind -- pointing every bookmarked URL and the site header at a 404, which is
 * a worse outcome than the broken link the redirect exists to prevent.
 */
const nextConfig: NextConfig = {
  // The upstream feeds this app reads are only ever touched from server
  // components. core/upstream.ts and activities/tidepool/grid.ts both carry
  // `import 'server-only'`, so a client component that pulls one in fails the
  // build rather than shipping a NOAA request to a browser. That enforcement
  // lives in the modules, not here.
  reactStrictMode: true,

  /**
   * The paths #127 moved, forwarded rather than broken.
   *
   * -------------------------------------------------------------------------
   * Why redirect at all
   * -------------------------------------------------------------------------
   *
   * Both old paths are answered by a page that still exists, at a new address,
   * with the same content. Nothing about the move makes the old URL meaningless,
   * so breaking it would be discarding a working link for no gain. `/` in
   * particular is what a reader has bookmarked and what the site header points
   * at.
   *
   * -------------------------------------------------------------------------
   * Why both are temporary, and not one 308
   * -------------------------------------------------------------------------
   *
   * `permanent: true` emits a 308, and a browser caches that with no
   * revalidation and no expiry. It is the one class of redirect that cannot be
   * taken back from a reader who has already followed it once, and neither of
   * these is a claim this repo is in a position to make permanently:
   *
   *   `/`                    stops being a redirect the moment #101's corridor
   *                          overview lands. A cached 308 would send every
   *                          reader who ever visited straight past the new page.
   *   `/spot/:slug/:date`    is contingent on #133, which decides what the spot
   *                          page becomes. Its answer could put a day view back
   *                          under `/spot/`.
   *
   * There is nothing to lose by being temporary. `app/robots.ts` disallows the
   * day path and the day route sets `index: false, follow: false`, so no crawler
   * holds either address and no ranking rides on the hop.
   */
  async redirects() {
    return [
      // Exactly `/`, not a prefix: `/robots.txt` and `/spot/<slug>` are unaffected.
      { source: '/', destination: tidepoolGridPath(), permanent: false },
      {
        source: '/spot/:slug/:date',
        destination: `${tidepoolGridPath()}/:slug/:date`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
