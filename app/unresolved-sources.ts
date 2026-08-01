import { THRESHOLDS_UNRESOLVED, THRESHOLDS_VERSION } from '@/core/thresholds';
import { SURF_THRESHOLDS_VERSION, SURF_UNRESOLVED } from '@/activities/surf/thresholds';
import { SPOTS_FILE, SPOTS_VERSION } from '@/shared/spots.generated';
import type { UnresolvedSource } from '@/core/components/unresolved';

/**
 * Which files a reader is owed disclosure from, assembled where the imports are
 * legal.
 *
 * This list lived inside core/components/unresolved.tsx until #128 split
 * thresholds per activity. `core/` may not import an activity, and
 * activities/surf/thresholds.json now holds two caveats that were being
 * rendered the day before -- so the list had to move to the one layer allowed
 * to see every slice, which is this one.
 *
 * ---------------------------------------------------------------------------
 * Why a file moving must never quietly take its caveats off the page
 * ---------------------------------------------------------------------------
 *
 * unresolved.tsx exists because eleven recorded caveats were being loaded and
 * dropped. Moving the two surf overrides into a file nothing imported would
 * have done the same thing again, by a different route and with better
 * intentions: the values would have been correctly filed and the reader would
 * have been told less. The rule this encodes is that a data file's caveats
 * follow the data, and something renders them from wherever they land.
 *
 * It is still a hand-written list, which is what #132 replaces with a walk over
 * every zone file and every activity. What #128 changed is where the list is
 * allowed to live, not how it is built.
 */
export const UNRESOLVED_SOURCES: readonly UnresolvedSource[] = [
  /*
   * Thresholds first. They are the values that decide a verdict, and they are
   * the ones with no upstream authority behind them at all. Corridor-wide
   * before per-activity, because the default is what applies to every spot the
   * grid actually renders.
   */
  {
    subject: 'The corridor swell ceiling',
    file: 'shared/thresholds.json',
    version: THRESHOLDS_VERSION,
    entries: THRESHOLDS_UNRESOLVED,
  },
  {
    subject: 'Surf ceilings',
    file: 'activities/surf/thresholds.json',
    version: SURF_THRESHOLDS_VERSION,
    entries: SURF_UNRESOLVED,
  },
  {
    subject: 'The spot inventory',
    file: 'shared/spots.json',
    version: SPOTS_VERSION,
    entries: SPOTS_FILE.unresolved,
  },
];
