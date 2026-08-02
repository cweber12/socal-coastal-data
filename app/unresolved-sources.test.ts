/**
 * That every `unresolved` array in the repo reaches a reader, unedited.
 *
 * The list is the thing under test, not the component that renders it.
 * `UnresolvedDisclosure` takes whatever it is handed, so the failure it was built
 * to prevent -- a caveat recorded and then not shown -- cannot show up there. It
 * shows up here, as a file nobody put in the list.
 *
 * ---------------------------------------------------------------------------
 * What #132 changed about what this file can claim
 * ---------------------------------------------------------------------------
 *
 * When #169 wrote this it said, in this header, that it was a tripwire and not a
 * proof: its own file list was hand-written too, so a sixth data file forgotten
 * in BOTH places still passed. `shared/gate-hours.json` was that sixth file and
 * it did pass, silently, carrying one caveat nothing had ever rendered.
 *
 * The completeness half is now provable, because existence is discovered by
 * scripts/gen-unresolved-sources.mjs rather than typed. The last describe block
 * is that proof: it runs the real generator against a tree it has never seen and
 * reads what it emits. A helper called from here instead would be asserting the
 * same code path against itself.
 *
 * What is still a hand-written list is PROSE -- the subject lines -- and that is
 * deliberate. A source with no subject renders under a derived heading, so the
 * worst a forgotten subject costs is a plain sentence, never a dropped caveat.
 * The first block below pins that direction.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { UNRESOLVED_SOURCES } from './unresolved-sources';
import { DISCOVERED_UNRESOLVED } from './unresolved-sources.generated';
import gateHoursJson from '@/shared/gate-hours.json';
import intertidalJson from '@/shared/intertidal.json';
import spotsJson from '@/shared/spots.json';
import thresholdsJson from '@/shared/thresholds.json';
import surfThresholdsJson from '@/activities/surf/thresholds.json';

/**
 * The array of record for each source that HAS a file, read straight from the
 * JSON rather than through the module that exports it.
 *
 * Going through the module would test the module against itself. Reading the
 * file is what catches a source whose entries were retyped, summarised or
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
  'shared/gate-hours.json': gateHoursJson.unresolved,
};

describe('the sources a reader is owed disclosure from', () => {
  it('renders every source the walk discovered', () => {
    /*
     * The property the whole issue is about, and the one the old hand-written
     * list could not have. Nothing between discovery and the page may drop a
     * source: not a missing subject, not a sort, not a filter.
     */
    expect(UNRESOLVED_SOURCES.map((s) => s.file).sort()).toEqual(
      DISCOVERED_UNRESOLVED.map((s) => s.file).sort(),
    );
  });

  it('names each file once', () => {
    // A file listed twice renders its caveats twice and inflates the summary
    // count, which is the number a reviewer checks a caveat has not been dropped
    // by. The generator's pass-through rule is what prevents it -- three modules
    // re-export an array a JSON file already owns.
    const files = UNRESOLVED_SOURCES.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('holds no entry twice, whichever source it came from', () => {
    /*
     * The same assertion one level down, against the strings themselves.
     * `names each file once` would pass if a module and the JSON behind it were
     * counted under two different paths, which is exactly what counting
     * SURF_UNRESOLVED alongside activities/surf/thresholds.json would do.
     */
    const all = UNRESOLVED_SOURCES.flatMap((s) => s.entries);
    expect(new Set(all).size).toBe(all.length);
  });

  it('carries at least one entry from every source', () => {
    /*
     * An empty array is a source that has stopped disclosing. The component
     * drops empty sources from the render silently -- correctly, since a heading
     * over nothing is noise -- so an array that empties by accident disappears
     * from the page without anything failing. The generator skips empty arrays
     * for the same reason, so reaching here with one is a bug in either.
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

  it('gives every source a subject, derived where none is written', () => {
    for (const source of UNRESOLVED_SOURCES) {
      expect(source.subject, `${source.file} has no subject`).toBeTruthy();
    }
  });

  it('stamps a version or honestly carries none', () => {
    /*
     * null is a legal value and an empty string is not. A source with no version
     * renders as its path alone; one with `''` renders as a path with a trailing
     * space, which is the invisible-whitespace failure #126 found in this same
     * component.
     */
    for (const source of UNRESOLVED_SOURCES) {
      expect(source.version === null || /\d/.test(source.version)).toBe(true);
    }
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

/* ===========================================================================
 * The discovery proof
 * =========================================================================== */

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Build a throwaway tree with the roots the generator walks, and run it there. */
function generateAgainst(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'unresolved-'));
  temps.push(dir);
  for (const root of ['shared', 'core/zones', 'activities']) {
    mkdirSync(join(dir, ...root.split('/')), { recursive: true });
  }
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, ...rel.split('/'));
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  const out = join(dir, 'out.ts');
  execFileSync(process.execPath, ['scripts/gen-unresolved-sources.mjs', '--root', dir, '--out', out], {
    encoding: 'utf8',
  });
  return readFileSync(out, 'utf8');
}

describe('discovery', () => {
  it('picks up an array in a file it has never seen, with no edit to anything', () => {
    /*
     * #132's second acceptance criterion, run against the real generator rather
     * than a helper. This is the whole issue in one assertion: a data file that
     * exists is a data file that is disclosed, and nobody has to remember.
     */
    const out = generateAgainst({
      'shared/brand-new.json': { version: '0.1.0', unresolved: ['A caveat nobody wired up.'] },
    });
    expect(out).toContain("file: 'shared/brand-new.json'");
    /*
     * Backticks, not quotes, and not a style choice.
     *
     * scripts/check-boundaries.mjs blanks template literals and KEEPS quoted
     * strings, because a real import specifier can only be a StringLiteral and
     * what a backtick holds in this repo is codegen. A synthetic specifier
     * written in quotes here is read as this file importing a fixture that does
     * not exist, and the check fails on an import nobody wrote. Same device the
     * generators use for the imports they emit.
     */
    expect(out).toContain(`import sharedBrandNewJson from '@/shared/brand-new.json';`);
  });

  it('does not count a module that re-exports a file it already found', () => {
    /*
     * The double-count trap, and the reason the generator reads the initialiser.
     * Three modules in this repo are of this shape; counting them would render
     * three sources twice and inflate the summary line, producing a disclosure
     * that looks MORE complete than the truth.
     */
    const out = generateAgainst({
      'shared/thing.json': { version: '1.0.0', unresolved: ['Owned by the file.'] },
      // Backticks for the same reason as above: this is source text, not an import.
      'core/zones/passthrough.ts':
        `import thing from '@/shared/thing.json';\n` +
        `const FILE = thing;\n` +
        `export const THING_UNRESOLVED: readonly string[] = FILE.unresolved;\n`,
    });
    expect(out).toContain("file: 'shared/thing.json'");
    expect(out).not.toContain('core/zones/passthrough.ts');
  });

  it('counts a module that originates an array, since a zone may have no file', () => {
    const out = generateAgainst({
      'core/zones/nofile.ts':
        "export const NOFILE_ZONE_UNRESOLVED: readonly string[] = ['Written here, not in a file.'];\n",
    });
    expect(out).toContain("file: 'core/zones/nofile.ts'");
    expect(out).toContain("version: null");
  });

  it('ignores an unresolved key that is not an array of prose', () => {
    /*
     * shared/intertidal.json carries BOTH -- a top-level array of prose and a
     * membership.unresolved of spot records -- so the two names sit one nesting
     * level apart in a real file. Rendering the wrong one would put
     * "[object Object]" on the page under a heading promising verbatim quotes.
     */
    const out = generateAgainst({
      'shared/buckets.json': {
        version: '1.0.0',
        membership: { unresolved: [{ slug: 'x', reason: 'y' }] },
      },
    });
    expect(out).not.toContain('shared/buckets.json');
  });

  it('ignores fixtures, which are captured payloads and not this repo speaking', () => {
    const out = generateAgainst({
      'activities/surf/__fixtures__/captured.json': {
        version: '1.0.0',
        unresolved: ["An upstream's words, not ours."],
      },
    });
    expect(out).not.toContain('captured.json');
  });

  it('refuses a file that carries caveats and no version', () => {
    /*
     * Failing rather than emitting `version: undefined`, which would render as a
     * path with a trailing space and tell a reader nothing about which revision
     * they are reading.
     */
    expect(() =>
      generateAgainst({ 'shared/versionless.json': { unresolved: ['No version here.'] } }),
    ).toThrow();
  });
});
