/**
 * What the stack does not know, in the words of the files that say so.
 *
 * ---------------------------------------------------------------------------
 * Why this component exists
 * ---------------------------------------------------------------------------
 *
 * Both data files carry an `unresolved` array. It is this repo's designated
 * channel for stating what a value does not cover, and it is where a caveat
 * goes that cannot be expressed as a null. Between them they held eleven
 * entries and the app rendered none of them: `THRESHOLDS_UNRESOLVED` was
 * exported and referenced nowhere, and `SpotsFile.unresolved` was typed and
 * never read.
 *
 * That is the same failure the null-means-unresolved rule exists to prevent,
 * one layer up. A null that renders as a pass and a caveat that is loaded and
 * dropped are the same mistake: the uncertainty was recorded, and then the
 * reader was not told.
 *
 * It matters most on the swell ceiling. Over seven days from 2026-07-28 the
 * grid returned 22 vetoes out of 56 cells and not one `go`, every veto decided
 * against the corridor-default 3.0 ft. thresholds.json says in this array that
 * buoy significant wave height is not breaking height at the reef and that no
 * shoaling or refraction transform is applied. The number driving most of the
 * page was the number carrying the loudest unstated caveat.
 *
 * ---------------------------------------------------------------------------
 * Verbatim, and why
 * ---------------------------------------------------------------------------
 *
 * The entries are rendered exactly as the files write them, not summarised.
 * Summarising would put a second wording of a safety caveat in a second place,
 * which is how the two drift apart -- and the file is the one that gets updated
 * when a floor is finally field-checked.
 *
 * Collapsed by default, matching how PR #9 demoted the window states: visible
 * on request, never absent. With one exception, below.
 */

/**
 * An entry the file itself marks SAFETY is not collapsed.
 *
 * spots.json opens one entry with "SAFETY, stated in the direction that
 * matters" and ends it "Field-check Sunset Cliffs and Cabrillo before any of
 * these numbers is presented as advice." Putting that behind a summary, on a
 * page that presents those numbers, would be this bug again in miniature.
 *
 * The promotion is driven by the file's own marker, not by a judgement made
 * here about which caveat is the important one. Mark another entry SAFETY and
 * it surfaces too.
 */
const SAFETY_PREFIX = 'SAFETY';

export interface UnresolvedSource {
  /** What the file is the record of, in a reader's terms. */
  subject: string;
  /** The path, so a reader can go and read the whole thing. */
  file: string;
  /**
   * The revision the entries were read from, or null where the source has none.
   *
   * Null is not a missing value to be filled in later. Since #132 a source can
   * be a MODULE rather than a file -- core/zones/surf.ts derives its membership
   * from shared/spots.json's wave bindings and has nothing to put a version on
   * -- and stamping such a source with a borrowed version would tell a reader
   * that a number governs these words when none does. The composition root
   * supplies one where a borrowed version is defensible and says so; where it
   * does not, the path renders alone.
   */
  version: string | null;
  entries: readonly string[];
}

/**
 * "shared/spots.json 3.1.1", or just the path where there is no version.
 *
 * Built as one string rather than interpolated as two nodes on purpose. The
 * alternative renders a trailing space before the comma in the safety panel
 * whenever version is null -- invisible on screen and present in `innerText`,
 * which is what a screen reader and tools/ui-capture both read.
 */
const stamp = (source: UnresolvedSource) =>
  source.version === null ? source.file : `${source.file} ${source.version}`;

/**
 * The sources arrive as a prop, and this component names none of them.
 *
 * It hand-assembled two until #128, which is where that stopped being possible:
 * per-activity thresholds live under activities/ now, `core/` may not import an
 * activity, and this component is in `core/`. The composition root is the layer
 * allowed to see every slice, so it is the layer that says which files a reader
 * is owed disclosure from -- the shells-plus-slots pattern this directory is
 * built on, applied to data rather than to markup.
 *
 * It also stops this file being edited every time a data file is added, which is
 * what #132 is about. This does not do #132 -- the list is still written out by
 * hand, one layer up -- but it is now written where the imports are legal.
 */
export function UnresolvedDisclosure({ sources }: { sources: readonly UnresolvedSource[] }) {
  const safety = sources.flatMap((source) =>
    source.entries.filter((e) => e.startsWith(SAFETY_PREFIX)).map((text) => ({ source, text })),
  );
  const rest = sources.map((source) => ({
    source,
    entries: source.entries.filter((e) => !e.startsWith(SAFETY_PREFIX)),
  })).filter((s) => s.entries.length > 0);

  const restCount = rest.reduce((n, s) => n + s.entries.length, 0);
  if (safety.length === 0 && restCount === 0) return null;

  return (
    <section aria-labelledby="unresolved-heading" className="mt-6">
      <h2 id="unresolved-heading" className="sr-only">
        What this stack does not know
      </h2>

      {safety.map(({ source, text }) => (
        <div
          key={text.slice(0, 40)}
          className="tint-panel mb-2 rounded-md border p-3"
          style={{ ['--tint-color' as string]: 'var(--color-caution)' }}
        >
          {/*
            A heading, which this never had -- the panel began mid-sentence with
            the word SAFETY and read as a pasted log line. The heading is UI
            chrome around the quote, not a summary of it: summarising a safety
            caveat would put a second wording of it in a second place, which is
            the thing the file-verbatim rule exists to prevent.
          */}
          <h3 className="text-ui font-semibold tracking-wide uppercase">
            Safety — these floors are unverified
          </h3>
          <p className="mt-1.5 text-ui">{text}</p>
          <p className="tint-panel-source mt-2 text-meta">
            {stamp(source)}, <code>unresolved</code>
          </p>
        </div>
      ))}

      <details>
        <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
          {`${restCount} more things this stack does not know`}
        </summary>

        <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
          Quoted from the <code>unresolved</code> array in each data file, unedited. These are the
          caveats that cannot be written as a null — a value that is present and usable, with a
          stated limit on what it covers.
        </p>

        {rest.map(({ source, entries }) => (
          <div key={source.file} className="mt-3">
            {/*
              The `{' '}` is not decoration. Without it JSX drops the whitespace
              at the line break and this renders "REEF FLOORS AND SWELL
              CEILINGSshared/thresholds.json 0.1.0" -- invisible on screen
              behind the margin, and exactly what `innerText` and a screen
              reader get. Found by #126, which copied this pattern into the
              excluded-spots disclosure and saw it in the capture.
            */}
            <h3 className="text-meta font-semibold tracking-wide uppercase text-[var(--text-dim)]">
              {source.subject}{' '}
              <span className="font-normal normal-case tracking-normal text-[var(--text-dimmer)]">
                {stamp(source)}
              </span>
            </h3>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-meta text-[var(--text-dimmer)]">
              {entries.map((entry) => (
                <li key={entry.slice(0, 40)} className="max-w-prose">
                  {entry}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}
