import Link from 'next/link';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/components/disclosure';
import { MidnightNotice } from '@/components/midnight-notice';
import { SpotRow } from '@/components/spot-row';
import { SpotDisclosure } from '@/components/spot-summary';
import { UnresolvedDisclosure } from '@/components/unresolved';
import { UnevaluatedCell, WindowCell } from '@/components/window-cell';
import { HORIZON_DAYS, loadGrid, sortRows, type SortKey } from '@/lib/grid';
import { rowAriaLabel } from '@/lib/labels';
import {
  formatDateLong,
  formatDayMonth,
  formatLocalDate,
  formatWeekdayShort,
  startOfLocalDay,
} from '@/lib/time';
import { MIN_WINDOW_MINUTES, STATE_PRESENTATION, SWELL_HORIZON_DAYS, WINDOW_STATES } from '@/lib/windows';
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

      <div className="mt-4 overflow-x-auto">
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
              floorFt={row.spot.tidepool_floor_ft}
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
                <SpotDisclosure spot={row.spot} swell={row.swell} ceiling={row.ceiling} />
              }
            />
          ))}
        </table>
      </div>

      <Legend />

      <p className="mt-4 max-w-prose text-meta text-[var(--text-dimmer)] wide:hidden">
        Showing today only. The full week is on each spot&apos;s own page.
      </p>

      <Excluded names={grid.excludedSpotNames} />

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
      <UnresolvedDisclosure />

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

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-[var(--text-dim)]">
        <span
          data-lighting="day"
          className="cell-skin rounded border px-1.5 py-0.5 font-mono text-meta"
        >
          ▼ 0.2 1:14 pm
        </span>
        <span>low in daylight</span>
        <span aria-hidden className="text-[var(--text-dimmer)]">
          ·
        </span>
        <span
          data-lighting="night"
          className="cell-skin rounded border px-1.5 py-0.5 font-mono text-meta"
        >
          ▼ 0.2 4:41 am
        </span>
        <span>low after dark</span>
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
    case 'dark':
      return 'window falls outside the daylight left';
    case 'above-floor':
      return 'this low does not uncover the reef';
    case 'swell-tbd':
      return 'swell unknown — never a pass';
  }
}

/**
 * The spots this grid does not cover, named rather than silently absent.
 *
 * Eighteen of the twenty-six have a null tidepool_floor_ft. A null is unresolved,
 * and inventing floors to fill the grid out would be exactly the hand-populated
 * number spots.json warns against.
 */
function Excluded({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
        {names.length} spots are not in this grid
      </summary>
      <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
        These carry no <code>tidepool_floor_ft</code> in spots.json. A null floor is unresolved,
        not zero, and a window cannot be computed without one. Estimating floors to fill the grid
        out would put a hand-typed number where a measurement belongs.
      </p>
      <p className="mt-1.5 text-meta text-[var(--text-dimmer)]">{names.join(' · ')}</p>
    </details>
  );
}
