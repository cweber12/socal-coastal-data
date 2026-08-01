/**
 * Where this activity's pages live, and the only place its URL segment is
 * written down.
 *
 * The same device activities/tidepool/routes.ts carries, and it is now doing the
 * job it was written for rather than the one it could be argued into. That file
 * says a cell linking to `/surf/<slug>/<date>` while showing tidepool's verdict
 * is "a typo away when the segment is a literal" -- with one activity that was a
 * prediction, and with two it is a live hazard on every cell of both grids.
 *
 * `scripts/check-boundaries.mjs` is what makes this safe rather than merely
 * tidy: no activity may import another, so this file cannot reach tidepool's and
 * tidepool's cannot reach this one. Each segment is declared in its own
 * directory and there is no shared constant either could drift from.
 */

import { formatLocalDate, type LocalDate } from '../../core/time';

/** This activity's URL segment. Also its directory name and its registry key. */
export const SURF_SLUG = 'surf';

/** The verdict grid: every surf-zone spot, seven days. */
export function surfGridPath(): string {
  return `/${SURF_SLUG}`;
}

/** One spot, one day: the tide chart, the band, and the sessions it produced. */
export function surfDayPath(spotSlug: string, date: LocalDate): string {
  return `/${SURF_SLUG}/${spotSlug}/${formatLocalDate(date)}`;
}
