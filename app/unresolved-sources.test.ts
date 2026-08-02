/**
 * That every source this list names actually reaches a reader, unedited.
 *
 * The list itself is the thing under test, not the component that renders it.
 * `UnresolvedDisclosure` takes whatever it is handed, so the failure mode it was
 * built to prevent -- a caveat recorded and then not shown -- cannot show up
 * there at all. It shows up HERE, as a file whose `unresolved` array is never
 * put in the array below.
 *
 * That is not hypothetical and it is why this file exists. #169 found
 * `INTERTIDAL_FILE_UNRESOLVED` exported from shared/intertidal.generated.ts with
 * zero call sites: three caveats loaded and dropped, in a file created after the
 * hand-written list was written, while the component's own header described the
 * identical bug in the two files that came before it.
 *
 * What this cannot assert is the part #132 is for: that no file with an
 * `unresolved` array has been left OUT. Proving that needs the walk, and until
 * the walk exists the honest statement is that this pins what the list claims,
 * not that the list is complete. The one thing it can do about completeness is
 * name the files known to carry an array today and fail if one goes missing,
 * which is the last case below.
 */

import { describe, expect, it } from 'vitest';

import { UNRESOLVED_SOURCES } from './unresolved-sources';
import intertidalJson from '@/shared/intertidal.json';
import spotsJson from '@/shared/spots.json';
import thresholdsJson from '@/shared/thresholds.json';
import surfThresholdsJson from '@/activities/surf/thresholds.json';

/**
 * The array of record for each source that HAS a file, read straight from the
 * JSON rather than through the module that exports it.
 *
 * Going through the module would test the module against itself. Reading the
 * file is what catches a source whose `entries` were retyped, summarised or
 * pointed at the wrong array -- the drift core/components/unresolved.tsx renders
 * verbatim to avoid.
 *
 * `core/zones/surf.ts` is deliberately absent: its entries are written in a
 * TypeScript module because that zone has no file, which is itself one of the
 * things it discloses. There is no second copy of them to compare against.
 */
const ARRAY_OF_RECORD: Record<string, readonly string[]> = {
  'shared/thresholds.json': thresholdsJson.unresolved,
  'activities/surf/thresholds.json': surfThresholdsJson.unresolved,
  'shared/intertidal.json': intertidalJson.unresolved,
  'shared/spots.json': spotsJson.unresolved,
};

describe('the sources a reader is owed disclosure from', () => {
  it('names each file once', () => {
    // A file listed twice renders its caveats twice and inflates the summary
    // count, which is the number a reviewer checks a caveat has not been dropped
    // by.
    const files = UNRESOLVED_SOURCES.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('carries at least one entry from every source', () => {
    /*
     * An empty array is a source that has stopped disclosing. The component
     * drops empty sources from the render silently -- correctly, since a heading
     * over nothing is noise -- so an array that empties by accident disappears
     * from the page without anything failing.
     */
    for (const source of UNRESOLVED_SOURCES) {
      expect(source.entries.length, `${source.file} has no entries`).toBeGreaterThan(0);
    }
  });

  it('quotes each file verbatim, in the file order', () => {
    for (const source of UNRESOLVED_SOURCES) {
      const record = ARRAY_OF_RECORD[source.file];
      if (record === undefined) continue;
      expect(source.entries, `${source.file} does not match its own array`).toEqual(record);
    }
  });

  it('stamps each source with a version', () => {
    // The version is what tells a reader which revision of the file they are
    // reading a caveat from, and an empty string renders as a bare filename.
    for (const source of UNRESOLVED_SOURCES) {
      expect(source.version, `${source.file} has no version`).toMatch(/\d/);
    }
  });

  it('includes every file known to carry an unresolved array', () => {
    /*
     * The #169 regression, stated as a property. shared/intertidal.json carried
     * three caveats past two releases with nothing importing them, and no check
     * in this repo could tell.
     *
     * This list is hand-written, exactly like the one it checks, so it is a
     * tripwire rather than a proof: adding a sixth file and forgetting both
     * lists still passes. #132's walk is what makes that impossible; this makes
     * forgetting one of the two harder than forgetting one.
     */
    const files = new Set(UNRESOLVED_SOURCES.map((s) => s.file));
    for (const file of Object.keys(ARRAY_OF_RECORD)) {
      expect(files.has(file), `${file} has an unresolved array that reaches no reader`).toBe(true);
    }
    expect(files.has('core/zones/surf.ts')).toBe(true);
  });
});

describe('what the summary line counts', () => {
  /*
   * The invariant, because the number is what a reviewer reads to tell whether a
   * caveat was dropped: SUMMARY LINE = TOTAL RENDERED - SAFETY ENTRIES.
   *
   * `UnresolvedDisclosure` promotes any entry the file itself opens with SAFETY
   * out of the collapsed section, so the summary counts everything except those.
   * There is exactly one such entry today, in shared/spots.json, and the
   * component renders every promoted entry under the hardcoded heading "Safety
   * -- these floors are unverified" -- which is true of that entry and would be
   * false of a caveat about anything but a floor. So the count below is the
   * check, and the prefix is not an invitation.
   */
  const SAFETY_PREFIX = 'SAFETY';
  const all = UNRESOLVED_SOURCES.flatMap((s) => s.entries);

  it('shows every entry either promoted or collapsed, never neither', () => {
    const promoted = all.filter((e) => e.startsWith(SAFETY_PREFIX));
    const collapsed = all.filter((e) => !e.startsWith(SAFETY_PREFIX));
    expect(promoted.length + collapsed.length).toBe(all.length);
    expect(collapsed.length).toBe(all.length - promoted.length);
  });

  it('promotes nothing from shared/intertidal.json', () => {
    /*
     * Not a preference. The promoted heading says these floors are unverified,
     * and none of that file's three entries is about a floor -- the third is
     * explicitly about the floor caveats NOT being there. Marking one SAFETY
     * would ship a true caveat under a false heading.
     */
    const intertidal = UNRESOLVED_SOURCES.find((s) => s.file === 'shared/intertidal.json');
    expect(intertidal?.entries.some((e) => e.startsWith(SAFETY_PREFIX))).toBe(false);
  });
});
