import { TIDEPOOL_SLUG } from '@/activities/tidepool/routes';

/**
 * Which activities have routes, and the only thing that turns a URL segment into
 * one.
 *
 * ---------------------------------------------------------------------------
 * Routed is not the same as built
 * ---------------------------------------------------------------------------
 *
 * `activities/surf/` exists today. It holds two per-spot swell ceilings and a
 * reader for them, and `app/unresolved-sources.ts` renders its caveats on every
 * page -- but there is no surf predicate, no surf grid, and nothing that could
 * answer `/surf`. #129 builds that.
 *
 * So this list is not "the directories under activities/". A registry derived
 * from the filesystem would have routed `/surf` the day #128 landed the
 * thresholds, and the page would have had nothing to render or, worse, would
 * have fallen back to the one activity that does compute -- serving tidepool's
 * verdicts under a URL that says surf. That is the same class of failure as a
 * null rendering as a pass, and it is why an unrecognised segment is a 404 here
 * rather than a default.
 *
 * A slug enters this list in the same PR that gives it something to render.
 *
 * ---------------------------------------------------------------------------
 * Why the registry is in app/ and not in activities/
 * ---------------------------------------------------------------------------
 *
 * Not a preference -- `scripts/check-boundaries.mjs` refuses the alternative.
 * A registry at `activities/registry.ts` is classified by `activityOf` as its
 * own activity, so its import of `activities/tidepool/routes` is a
 * sibling-activity edge and fails the check:
 *
 *     activities/registry.ts -> activities/tidepool is not an allowed edge
 *       activities/registry.ts:1
 *       imports './tidepool/routes'
 *       (no row of its own; one activity may never import another)
 *
 * Which is the rule working, not an obstacle to it. Something that names every
 * activity is by definition cross-activity, and `app/` is the one layer allowed
 * to import every slice. It is the same argument ADR 0010 makes for keeping
 * single-activity composition out of `app/`, run in the other direction.
 */
export const ROUTED_ACTIVITIES = [TIDEPOOL_SLUG] as const;

/** A URL segment known to name an activity with pages behind it. */
export type RoutedActivity = (typeof ROUTED_ACTIVITIES)[number];

/**
 * The activity a first path segment names, or null if it names none.
 *
 * Exact match, deliberately: no case folding, no trimming, no plural. A route
 * segment is untrusted input, and every forgiving comparison here is a second
 * URL that serves the same verdicts, which then has to be canonicalised
 * somewhere. `Tidepool` and `tidepools` are 404s.
 */
export function routedActivity(segment: string): RoutedActivity | null {
  return (ROUTED_ACTIVITIES as readonly string[]).includes(segment)
    ? (segment as RoutedActivity)
    : null;
}
