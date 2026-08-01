/**
 * Where this activity's pages live, and the only place its URL segment is
 * written down.
 *
 * ---------------------------------------------------------------------------
 * Why an activity owns its own segment
 * ---------------------------------------------------------------------------
 *
 * `/tidepool/<slug>/<date>` names the activity in its first segment, and the
 * string in that segment is this activity's identity -- the same word that names
 * this directory and the key `app/activities.ts` routes on. Written once here,
 * everything else imports it: the registry, the grid's own sort links, the cells
 * that link to a day, and the day page's arrows.
 *
 * Written per call site instead, it is six string literals that all have to say
 * `tidepool`, in files that will sit next to surf's equivalents. A cell linking
 * to `/surf/<slug>/<date>` while showing tidepool's verdict is the failure #127
 * is about -- a URL serving a different activity's judgement than the one it
 * names -- and it is a typo away when the segment is a literal.
 *
 * `scripts/check-boundaries.mjs` is what makes this safe rather than merely
 * tidy: no activity may import another, so surf cannot reach this file, and its
 * own segment has to be declared in its own directory.
 *
 * ---------------------------------------------------------------------------
 * Why the day path takes a LocalDate and not a string
 * ---------------------------------------------------------------------------
 *
 * The route parses its date segment with `tryParseLocalDate`, which accepts
 * `YYYY-MM-DD` and nothing else -- not `2026-7-4`, not `2026-02-30`. Taking the
 * structured date and formatting it here means the builder and the parser agree
 * by construction, rather than by two files happening to use the same format.
 * A caller cannot hand this a date it has already formatted its own way.
 */

import { formatLocalDate, type LocalDate } from '../../core/time';

/** This activity's URL segment. Also its directory name and its registry key. */
export const TIDEPOOL_SLUG = 'tidepool';

/** The verdict grid: every intertidal spot, seven days. */
export function tidepoolGridPath(): string {
  return `/${TIDEPOOL_SLUG}`;
}

/** One spot, one day: the tide chart and the verdict behind it. */
export function tidepoolDayPath(spotSlug: string, date: LocalDate): string {
  return `/${TIDEPOOL_SLUG}/${spotSlug}/${formatLocalDate(date)}`;
}
