import { SPOTS_VERSION } from '@/shared/spots.generated';
import { DISCOVERED_UNRESOLVED } from '@/app/unresolved-sources.generated';
import type { UnresolvedSource } from '@/core/components/unresolved';

/**
 * Which files a reader is owed disclosure from, in the order the case is made.
 *
 * ---------------------------------------------------------------------------
 * What changed in #132, and what it was for
 * ---------------------------------------------------------------------------
 *
 * This file used to BE the list. Five entries, each naming a file by hand, and a
 * file nobody added a line for reached no reader at all. That is not a risk this
 * describes; it is twice-measured history:
 *
 *   #169  shared/intertidal.json carried 3 caveats and its export had zero call
 *         sites, for as long as the file existed.
 *   #132  shared/gate-hours.json carried 1 and had never been rendered either.
 *         Found by enumerating the files, which is what the generator now does
 *         on every run.
 *
 * So EXISTENCE moved out. scripts/gen-unresolved-sources.mjs walks shared/,
 * core/zones/ and activities/, and app/unresolved-sources.generated.ts is what
 * it found. A data file added tomorrow appears on the page with no edit to this
 * file, no edit to core/components/unresolved.tsx, and no edit to the generator.
 *
 * What stayed is PROSE and ORDER, because neither is derivable and both are what
 * a reader actually reads. `SUBJECTS` below cannot make a source appear and
 * cannot make one vanish. A source it does not name still renders, under a
 * heading derived from its path -- worse prose, never silence. That asymmetry is
 * the whole design: this file can improve a disclosure and can no longer
 * withhold one.
 *
 * ---------------------------------------------------------------------------
 * Why the composition root and not core/
 * ---------------------------------------------------------------------------
 *
 * #128 moved the list here when thresholds split per activity: `core/` may not
 * import an activity, activities/surf/thresholds.json holds caveats that were
 * being rendered the day before, and this is the one layer allowed to see every
 * slice. That is still why the generated file is under app/ too -- it imports
 * from shared/, core/zones/ AND activities/, which nothing else may do.
 */

/**
 * The subject line for each source, in render order.
 *
 * Order is an argument, not a listing: here are the numbers a verdict is decided
 * against, here is what the zones they apply to do and do not claim, here is the
 * inventory underneath all of it, here is the gate that decides whether a reader
 * can get to any of it. A directory walk cannot produce that, which is why this
 * array exists at all.
 *
 * A discovered source missing from here sorts to the end and takes a derived
 * heading. It appears at the bottom rather than in the middle of the argument,
 * which is the right place for something nobody has written a sentence about
 * yet.
 */
const SUBJECTS: readonly { file: string; subject: string; version?: string }[] = [
  /*
   * Thresholds first. They are the values that decide a verdict, and they are
   * the ones with no upstream authority behind them at all. Corridor-wide before
   * per-activity, because the default is what applies to every spot the grid
   * actually renders.
   */
  { file: 'shared/thresholds.json', subject: 'The corridor swell ceiling' },
  {
    file: 'activities/surf/thresholds.json',
    subject: 'Surf thresholds — the band, the ceilings and the minimum',
  },
  /*
   * The surf zone, which is a module rather than a file, and the one source here
   * with no version of its own.
   *
   * Its membership is DERIVED from shared/spots.json's wave bindings rather than
   * listed, which is the whole point of it -- there is no hand-written surf
   * membership to drift out of step. So there is no file to put a version on,
   * and the version that governs it is the version of the file it derives from.
   * The generator emits null and this supplies it, because "which file's version
   * governs a derived module" is a judgement and not something a walk can see.
   */
  {
    file: 'core/zones/surf.ts',
    subject: 'The surf zone (derived from shared/spots.json)',
    version: SPOTS_VERSION,
  },
  {
    file: 'shared/intertidal.json',
    subject: 'The intertidal zone — what membership rests on',
  },
  { file: 'shared/spots.json', subject: 'The spot inventory' },
  /*
   * Gate hours, last, and rendered for the first time by #132.
   *
   * It carried one entry from the day the file was created and nothing ever
   * imported it -- the second instance of the failure #169 found, and the reason
   * that issue's "one more hand-wired entry is the honest interim" stopped being
   * true. A reader was being told the Cabrillo gate closes at 16:30 and was not
   * being told that the seasonal rule which would change that is recorded and
   * unapplied, on the one spot in the corridor whose gate decides whether the
   * trip is possible at all.
   *
   * Last because it is the narrowest claim here: one operator, one spot. The
   * derived fallback would have called it "Gate hours", which is not wrong and
   * is not what the file is the record of.
   */
  {
    file: 'shared/gate-hours.json',
    subject: 'Gate hours at Cabrillo, and the rule that is recorded but not applied',
  },
];

/**
 * A heading for a source nobody has written one for.
 *
 * `shared/gate-hours.json` -> `Gate hours`. Deliberately plain: it is a
 * placeholder that says what the file is called, and it exists so that the
 * absence of prose costs a reader a good sentence rather than the whole caveat.
 * Anything cleverer would read as a claim this repo has not made, about a file
 * nobody has looked at.
 */
function derivedSubject(file: string): string {
  const base = file.split('/').pop()!.replace(/\.(json|tsx?)$/, '');
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const ORDER = new Map(SUBJECTS.map((s, i) => [s.file, i]));
const BY_FILE = new Map(SUBJECTS.map((s) => [s.file, s]));

/**
 * Every discovered source, named where this file names one and derived where it
 * does not.
 *
 * Sorted by position in SUBJECTS, with unnamed sources after every named one and
 * stable among themselves in the generator's order. A default rank rather than a
 * filter, and the difference matters: a filter would drop a source with no
 * subject, which is the bug. Nothing here can remove a discovered source; the
 * sort only decides where it goes.
 *
 * MAX_SAFE_INTEGER and not Infinity. Two unnamed sources would compare
 * `Infinity - Infinity`, which is NaN, and a comparator that returns NaN has no
 * defined result -- the case this fallback exists to serve is precisely the one
 * it would have broken on, and it would have broken quietly as an order nobody
 * could explain.
 */
const rankOf = (file: string) => ORDER.get(file) ?? Number.MAX_SAFE_INTEGER;

export const UNRESOLVED_SOURCES: readonly UnresolvedSource[] = [...DISCOVERED_UNRESOLVED]
  .sort((a, b) => rankOf(a.file) - rankOf(b.file))
  .map((found) => {
    const named = BY_FILE.get(found.file);
    return {
      subject: named?.subject ?? derivedSubject(found.file),
      file: found.file,
      version: named?.version ?? found.version,
      entries: found.entries,
    };
  });
