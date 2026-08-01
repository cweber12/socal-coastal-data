import Link from 'next/link';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/core/components/disclosure';
import { MidnightNotice } from '@/core/components/midnight-notice';
import { SpotRow } from '@/core/components/spot-row';
import { SpotDisclosure } from '@/activities/tidepool/components/spot-summary';
import { UnresolvedDisclosure } from '@/core/components/unresolved';
import { UNRESOLVED_SOURCES } from '@/app/unresolved-sources';
import { UnevaluatedCell, WindowCell } from '@/activities/tidepool/components/window-cell';
import {
  HORIZON_DAYS,
  loadGrid,
  sortRows,
  type GridData,
  type SortKey,
} from '@/activities/tidepool/grid';
import { rowAriaLabel } from '@/activities/tidepool/labels';
import {
  formatDateLong,
  formatDayMonth,
  formatLocalDate,
  formatWeekdayShort,
  startOfLocalDay,
} from '@/core/time';
import { MIN_WINDOW_MINUTES, SWELL_HORIZON_DAYS } from '@/activities/tidepool/policy';
import { STATE_PRESENTATION, WINDOW_STATES } from '@/activities/tidepool/states';
import { SPOTS_VERSION, TIDE_DATUM } from '@/shared/spots.generated';

/**
 * Rendered per request.
 *
 * The whole page is a judgement about "now" -- today's column shows the next low
 * from the current time -- so a build-time prerender would freeze the evaluation
 * instant and quietly serve yesterday's answer. The upstream fetches are cached
 * independently by `next: { revalidate }` in lib/upstream.ts, so per-request
 * rendering costs a re-evaluation of the tide maths, not a re-fetch.
 */
export const dynamic = 'force-dynamic';

export default async function GridPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: sortParam } = await searchParams;
  const sort: SortKey = sortParam === 'geographic' ? 'geographic' : 'usable';

  const now = Date.now();
  const grid = await loadGrid(now);

  if (grid.failure) {
    return (
      <div className="space-y-4">
        <UpstreamFailure failure={grid.failure} what="Tide predictions" />
        <EvaluationStamp evaluatedAtMs={grid.evaluatedAtMs} timeZone={grid.timeZone} />
      </div>
    );
  }

  const rows = sortRows(grid.rows, sort);
  const dayStarts = grid.days.map((d) => startOfLocalDay(d, grid.timeZone));

  /*
   * Derived, never hardcoded.
   *
   * Today all eight evaluable spots bind to 9410230, which is why every row of
   * the grid shows the same seven lows -- and saying so is what turns that from
   * an apparent bug into a stated fact. But it is a fact about the current
   * contents of spots.json, not a property of the corridor. Bind one spot to
   * another station and the sentence becomes false, so it is computed and the
   * copy falls back when the set is not a singleton.
   */
  const stations = new Set(rows.map((r) => r.spot.tide_station));
  const sharedStation = stations.size === 1 ? [...stations][0] : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-title font-semibold tracking-tight">
            Daylight low-tide windows
          </h1>
          {/*
            One line, not six.

            This used to open with a paragraph explaining how to read a cell --
            the arrows, the light and dark backgrounds, the 45-minute minimum --
            which put a block of instructions between the heading and the thing
            it was instructions for. All of it is repeated in the legend below
            the grid, where it sits next to the swatches it describes and can be
            checked against them. It is now only there.

            What survives is the fact a reader cannot get from the grid by
            looking, and which makes the grid legible rather than broken: every
            row shows the same tide because every spot reads the same station.

            A JSX text node spanning several lines loses its LEADING space, so
            each number is bound to its unit inside one expression and every
            seam between an expression and a text node is an explicit {' '}.
          */}
          <p className="mt-1 max-w-prose text-ui text-[var(--text-dim)]">
            {`${rows.length} reef and tidepool spots over ${HORIZON_DAYS} days.`}{' '}
            {sharedStation ? (
              <>
                {`All of them read tide station ${sharedStation}, so the tide is the same down the
                  whole corridor — what differs is each reef's floor, and the number under each low
                  is how far that low sits from it.`}
              </>
            ) : (
              <>
                Each cell gives the low (▼), the high that follows it (▲), and how far that low sits
                from the spot&apos;s own reef floor.
              </>
            )}
          </p>
        </div>

        <nav aria-label="Sort order" className="flex items-center gap-1 text-ui">
          <span className="mr-1 text-[var(--text-dimmer)]">Sort</span>
          <SortLink current={sort} value="usable" label="Usable windows" />
          <SortLink current={sort} value="geographic" label="North to south" />
        </nav>
      </div>

      <div className="grid-scroller mt-4">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="sr-only">
            Daylight low-tide windows by spot and day. Each spot&apos;s name expands to its full
            week; each day links to that day&apos;s tide chart.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[11rem] px-1.5 pb-2 text-meta font-medium text-[var(--text-dimmer)]">
                Spot
              </th>
              {grid.days.map((date, i) => (
                <th
                  key={formatLocalDate(date)}
                  scope="col"
                  className={[
                    'px-1.5 pb-2 text-meta font-medium',
                    i === 0 ? 'text-[var(--text)]' : 'hidden text-[var(--text-dimmer)] wide:table-cell',
                  ].join(' ')}
                >
                  <span className="block">
                    {i === 0 ? 'Today' : formatWeekdayShort(dayStarts[i]!, grid.timeZone)}
                  </span>
                  <span className="block font-normal text-[var(--text-dimmer)]">
                    {formatDayMonth(dayStarts[i]!, grid.timeZone)}
                  </span>
                  {/*
                    Past the swell horizon. Dim rather than coloured: it is a
                    limit of the data, not an alarm about the day, and the cells
                    below it stopped shouting so the header should too.
                  */}
                  {i >= SWELL_HORIZON_DAYS ? (
                    <span
                      className="block font-normal text-[var(--text-dimmer)]"
                      title={`Past the ${SWELL_HORIZON_DAYS}-day swell horizon: there is no swell forecast in this stack, so no day beyond it can read as a pass.`}
                    >
                      no swell
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>

          {rows.map((row) => (
            <SpotRow
              key={row.spot.slug}
              spotName={row.spot.name}
              spotSlug={row.spot.slug}
              usableCount={row.usableCount}
              floorFt={row.spot.floorFt}
              rowLabel={rowAriaLabel(row.spot.name, row.usableCount, HORIZON_DAYS)}
              columnCount={grid.days.length + 1}
              cells={row.days.map((result, i) =>
                result ? (
                  <WindowCell
                    key={i}
                    spotSlug={row.spot.slug}
                    spotName={row.spot.name}
                    result={result}
                    timeZone={grid.timeZone}
                  />
                ) : (
                  <UnevaluatedCell
                    key={i}
                    spotName={row.spot.name}
                    date={grid.days[i]!}
                    dateMs={dayStarts[i]!}
                    timeZone={grid.timeZone}
                  />
                ),
              )}
              /*
                Deliberately NOT the week ribbon.

                SpotRow is a client component, and a prop handed to one is
                serialised into the flight payload whether the row is open or
                not -- so every collapsed ribbon shipped in full. That was
                163,926 bytes of a 345,152-byte RSC stream, 47%, for eight
                strips nobody had expanded.

                And the strip was redundant where it appeared. The disclosure
                row is `hidden wide:table-row`, so it only exists at >= 600px,
                and at >= 600px this row already shows all seven days. Opening
                it printed the same seven lows and highs again, one row lower.

                What a table row has nowhere to put is where the spot is, which
                floor and ceiling its verdicts are decided against, and which
                buoy the swell came from. That is what it discloses now.
              */
              detail={
                <SpotDisclosure
                  spot={row.spot}
                  swell={row.swell}
                  ceiling={row.ceiling}
                  sightings={row.sightings}
                  nowMs={grid.evaluatedAtMs}
                />
              }
            />
          ))}
        </table>
      </div>

      <Legend />

      <p className="mt-4 max-w-prose text-meta text-[var(--text-dimmer)] wide:hidden">
        Showing today only. The full week is on each spot&apos;s own page.
      </p>

      <Excluded
        excluded={grid.excluded}
        membership={grid.membership}
        fileVersion={grid.intertidalVersion}
      />

      {/*
        Two different kinds of caveat, kept apart deliberately.

        Notices are about THIS render: a buoy that did not answer just now, a
        day that would not evaluate, a format that has drifted. They change
        between requests.

        UnresolvedDisclosure is about the data itself and is the same on every
        request -- what the floors and the ceiling do not cover. Folding them
        together would let a standing limitation read as a transient upstream
        problem, and a reader would wait for it to clear.
      */}
      <UnresolvedDisclosure sources={UNRESOLVED_SOURCES} />

      <Notices notices={grid.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={grid.evaluatedAtMs}
          timeZone={grid.timeZone}
          extra={`spots.json ${SPOTS_VERSION} · datum ${TIDE_DATUM} · ${formatDateLong(dayStarts[0]!, grid.timeZone)}`}
        />
      </div>

      <MidnightNotice
        evaluatedAtMs={grid.evaluatedAtMs}
        timeZone={grid.timeZone}
        evaluatedDateLabel={formatDateLong(dayStarts[0]!, grid.timeZone)}
      />
    </div>
  );
}

function SortLink({
  current,
  value,
  label,
}: {
  current: SortKey;
  value: SortKey;
  label: string;
}) {
  const active = current === value;
  return (
    <Link
      href={value === 'usable' ? '/' : `/?sort=${value}`}
      aria-current={active ? 'true' : undefined}
      className={[
        'rounded border px-2 py-1 no-underline',
        active
          ? 'border-[var(--border-strong)] bg-[var(--surface-sunken)] font-medium'
          : 'border-transparent text-[var(--text-dim)] hover:border-[var(--border)]',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}

/**
 * The key.
 *
 * Two parts, and the split is the point. What a cell actually says -- light or
 * dark -- is one sentence, always visible, because a reader has to know what the
 * background means to read the grid at all. What the flags mean is a list of six
 * verdicts, collapsed, because the flags themselves are collapsed: a legend for
 * something hidden by default would be louder than the thing it explains.
 */
function Legend() {
  return (
    <section aria-labelledby="key-heading" className="mt-4">
      <h2 id="key-heading" className="sr-only">
        How to read this grid
      </h2>

      {/*
        Each swatch and its label are one unwrappable unit.

        The flex row wrapped between them at 375px, which left "low after dark"
        stranded on its own line under the DAY swatch -- a legend that, read
        straight down, said the opposite of what it means.
      */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-[var(--text-dim)]">
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span
            data-lighting="day"
            className="cell-skin rounded border px-1.5 py-0.5 font-mono text-meta"
          >
            ▼ 0.2 1:14 pm
          </span>
          <span>low in daylight</span>
        </span>
        <span aria-hidden className="text-[var(--text-dimmer)]">
          ·
        </span>
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span
            data-lighting="night"
            className="cell-skin rounded border px-1.5 py-0.5 font-mono text-meta"
          >
            ▼ 0.2 4:41 am
          </span>
          <span>low after dark</span>
        </span>
      </p>

      {/*
        Moved down from the page intro, which was six lines of instructions
        standing between the heading and the grid. It belongs here, beside the
        swatches, where a reader can check each sentence against the thing it
        describes instead of holding it in memory while scrolling past a table.
      */}
      <p className="mt-2 max-w-prose text-meta text-[var(--text-dim)]">
        Each cell gives the low (▼), the high that follows it (▲), and the low&apos;s distance from
        that spot&apos;s reef floor — negative when the low gets under the floor and uncovers reef.
        Today&apos;s column is the next low from now; later days show that day&apos;s best daylight
        low.{' '}
        {`A window needs ${MIN_WINDOW_MINUTES} minutes to count, and that judgement sits behind the badge on each cell.`}
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
          What the flag on each cell means
        </summary>
        <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
          Every cell carries an <span className="font-mono">i</span> badge. Opening it gives one of
          these six, with the sentence behind it. They are kept closed because each one is decided
          against a floor and a swell ceiling that are author estimates, never field-checked — the
          tide and the clock in the cell are the measured part.
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-meta">
          {WINDOW_STATES.map((state) => {
            const p = STATE_PRESENTATION[state];
            return (
              <div key={state} className="flex items-center gap-1.5">
                <dt className="flex items-center gap-1 font-medium text-[var(--text-dim)]">
                  <span aria-hidden>{p.glyph}</span>
                  {p.label}
                </dt>
                <dd className="text-[var(--text-dimmer)]">{legendGloss(state)}</dd>
              </div>
            );
          })}
        </dl>
      </details>
    </section>
  );
}

function legendGloss(state: (typeof WINDOW_STATES)[number]): string {
  switch (state) {
    case 'go':
      return `${MIN_WINDOW_MINUTES}+ min in daylight, swell under the ceiling`;
    case 'brief':
      return `under ${MIN_WINDOW_MINUTES} min`;
    case 'veto':
      return 'swell over the ceiling';
    case 'closed':
      return 'window falls outside the operator’s gate hours';
    case 'dark':
      return 'window falls outside the daylight left';
    case 'above-floor':
      return 'this low does not uncover the reef';
    case 'swell-tbd':
      return 'swell unknown — never a pass';
  }
}

/**
 * The spots this grid does not cover, in the two different senses of "not".
 *
 * ---------------------------------------------------------------------------
 * The claim this replaces
 * ---------------------------------------------------------------------------
 *
 * Until #126 this said all eighteen "carry no tidepool_floor_ft in spots.json.
 * A null floor is unresolved". Among the eighteen are Batiquitos Lagoon, San
 * Elijo Lagoon, Oceanside Harbor and Silver Strand -- two lagoons, a harbor and
 * a sand barrier, reported to a reader as reefs nobody had got around to
 * measuring. It is the mirror of the rule this repo enforces everywhere else: a
 * null never renders as a pass, and here it rendered as UNKNOWN when the truth
 * was NO SUCH THING IS HERE. One null carried two meanings, and no wording
 * fixed it while the data could not tell them apart. #124 split the data; this
 * renders the split.
 *
 * ---------------------------------------------------------------------------
 * Verbatim, and why the headings are careful
 * ---------------------------------------------------------------------------
 *
 * Each reason is printed exactly as shared/intertidal.json writes it, on the
 * same terms as UnresolvedDisclosure quotes the unresolved arrays: summarising
 * would put a second wording in a second place, and the file is the one that
 * gets edited when somebody finally walks a bench.
 *
 * The two headings are this component's own words, so they are written not to
 * make a claim the file does not. "No reef to measure" is not "not intertidal":
 * a mudflat IS intertidal, and Batiquitos exposes one twice a day. What those
 * four lack is a ROCKY BENCH whose surfacing height a floor could describe.
 * Calling them "not in the intertidal" would replace one wrong claim with
 * another, which is the whole failure mode of this section.
 */
function Excluded({
  excluded,
  membership,
  fileVersion,
}: {
  excluded: GridData['excluded'];
  membership: GridData['membership'];
  fileVersion: string;
}) {
  if (excluded.length === 0) return null;

  const noReef = excluded.filter((n) => n.membership === 'not_in_zone');
  const unmeasured = excluded.filter((n) => n.membership === 'unresolved');

  /*
   * The arithmetic, shown rather than implied.
   *
   * A reader seeing 8 rows and 18 excluded spots cannot tell whether 26 is the
   * whole inventory or whether something fell down the gap between them. The
   * zone module throws on load for a spot in no bucket, so a page that renders
   * at all has a complete set -- but "it would have crashed" is not something a
   * reader can see, and a silently absent spot is the failure one layer up from
   * the one this section is about.
   */
  const accounted = membership.members + membership.notInZone + membership.unresolved;
  const complete = accounted === membership.inventory;

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
        {excluded.length} spots are not in this grid, for two different reasons
      </summary>

      <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
        {complete ? (
          <>
            {membership.members} of {membership.inventory} spots carry a measured floor and are in
            the grid above. The other {excluded.length} are below, and every spot in the inventory
            is in exactly one of the three groups.
          </>
        ) : (
          // Never reached while the zone module throws on an unclassified spot.
          // Present because a count that silently fails to add up is the thing
          // being guarded against, and it must not be invisible if it happens.
          <strong>
            {accounted} of {membership.inventory} spots are accounted for. {membership.inventory - accounted}{' '}
            are in no group at all, which is a bug in shared/intertidal.json and not a fact about
            the coast.
          </strong>
        )}
      </p>

      <ExcludedGroup
        heading="No reef to measure"
        blurb="Nothing here surfaces that a floor could describe. These are not unsurveyed reefs, and no floor will be set for them."
        entries={noReef}
      />

      <ExcludedGroup
        heading="Not established either way"
        blurb="Whether a reef bench exists at these coordinates has not been determined. A floor is not withheld here — it is unknown, and inventing one to fill the grid out would put a hand-typed number where a measurement belongs."
        entries={unmeasured}
      />

      <p className="tint-panel-source mt-3 text-meta">
        Reasons quoted from <code>shared/intertidal.json</code> {fileVersion},{' '}
        <code>membership</code>, unedited.
      </p>
    </details>
  );
}

/**
 * One membership group: a heading, this component's framing, and the file's
 * words per spot.
 *
 * A description list rather than a paragraph each, because that is what this
 * is: a term and what is said about it. A screen reader announces the pairing;
 * eighteen loose paragraphs would not.
 */
function ExcludedGroup({
  heading,
  blurb,
  entries,
}: {
  heading: string;
  blurb: string;
  entries: GridData['excluded'];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-3">
      {/*
        The explicit space is load-bearing, and this page already documents the
        trap once: a JSX text node loses the whitespace at a line break, so
        `{heading}` followed by a `<span>` on the next line renders "NO REEF TO
        MEASURE4 spots". The margin hides it on screen and nothing hides it from
        `innerText` or from a screen reader, which announces the two words run
        together.
      */}
      <h3 className="text-meta font-semibold tracking-wide uppercase text-[var(--text-dim)]">
        {heading}{' '}
        <span className="font-normal normal-case tracking-normal text-[var(--text-dimmer)]">
          {entries.length} {entries.length === 1 ? 'spot' : 'spots'}
        </span>
      </h3>
      <p className="mt-1 max-w-prose text-meta text-[var(--text-dimmer)]">{blurb}</p>
      <dl className="mt-1.5 space-y-1.5 text-meta text-[var(--text-dimmer)]">
        {entries.map(({ spot, reason }) => (
          <div key={spot.slug}>
            <dt className="font-medium text-[var(--text-dim)]">{spot.name}</dt>
            <dd className="max-w-prose">{reason}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
