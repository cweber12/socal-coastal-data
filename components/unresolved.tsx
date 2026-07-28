import { THRESHOLDS_UNRESOLVED, THRESHOLDS_VERSION } from '@/lib/thresholds';
import { SPOTS_FILE, SPOTS_VERSION } from '@/shared/spots.generated';

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

interface UnresolvedSource {
  /** What the file is the record of, in a reader's terms. */
  subject: string;
  /** The path, so a reader can go and read the whole thing. */
  file: string;
  version: string;
  entries: readonly string[];
}

/**
 * Thresholds first. They are the values that decide a verdict, and they are the
 * ones with no upstream authority behind them at all.
 */
const SOURCES: readonly UnresolvedSource[] = [
  {
    subject: 'Reef floors and swell ceilings',
    file: 'shared/thresholds.json',
    version: THRESHOLDS_VERSION,
    entries: THRESHOLDS_UNRESOLVED,
  },
  {
    subject: 'The spot inventory',
    file: 'shared/spots.json',
    version: SPOTS_VERSION,
    entries: SPOTS_FILE.unresolved,
  },
];

export function UnresolvedDisclosure() {
  const safety = SOURCES.flatMap((source) =>
    source.entries.filter((e) => e.startsWith(SAFETY_PREFIX)).map((text) => ({ source, text })),
  );
  const rest = SOURCES.map((source) => ({
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
          <p className="max-w-prose text-xs leading-relaxed">{text}</p>
          <p className="mt-1.5 text-[0.68rem] text-[var(--text-dimmer)]">
            {source.file} {source.version}, <code>unresolved</code>
          </p>
        </div>
      ))}

      <details>
        <summary className="cursor-pointer text-xs text-[var(--text-dimmer)]">
          {`${restCount} more things this stack does not know`}
        </summary>

        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--text-dimmer)]">
          Quoted from the <code>unresolved</code> array in each data file, unedited. These are the
          caveats that cannot be written as a null — a value that is present and usable, with a
          stated limit on what it covers.
        </p>

        {rest.map(({ source, entries }) => (
          <div key={source.file} className="mt-3">
            <h3 className="text-[0.7rem] font-semibold tracking-wide uppercase text-[var(--text-dim)]">
              {source.subject}
              <span className="ml-1.5 font-normal normal-case tracking-normal text-[var(--text-dimmer)]">
                {source.file} {source.version}
              </span>
            </h3>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-[var(--text-dimmer)]">
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
