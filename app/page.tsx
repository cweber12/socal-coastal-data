import Link from 'next/link';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/components/disclosure';
import { MidnightNotice } from '@/components/midnight-notice';
import { SpotRow } from '@/components/spot-row';
import { UnevaluatedCell, WindowCell } from '@/components/window-cell';
import { WeekRibbon } from '@/components/week-ribbon';
import { HORIZON_DAYS, loadGrid, type SpotRow as SpotRowData } from '@/lib/grid';
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

type SortKey = 'usable' | 'geographic';

function sortRows(rows: readonly SpotRowData[], sort: SortKey): SpotRowData[] {
  if (sort === 'geographic') {
    // spots.json is already ordered north to south, from Oceanside Harbour down
    // to Border Field, and TIDEPOOL_SPOTS preserves that order. Geographic sort is
    // the file's own order -- deriving it from latitude again would be a second
    // source of truth that could disagree with the file.
    return [...rows];
  }
  return [...rows].sort((a, b) => {
    if (b.usableCount !== a.usableCount) return b.usableCount - a.usableCount;
    // Ties broken by how much window today actually has left, then by name, so
    // the order is stable rather than dependent on sort implementation.
    const aToday = a.days[0]?.minutesRemaining ?? a.days[0]?.usableMinutes ?? 0;
    const bToday = b.days[0]?.minutesRemaining ?? b.days[0]?.usableMinutes ?? 0;
    if (bToday !== aToday) return bToday - aToday;
    return a.spot.name.localeCompare(b.spot.name);
  });
}

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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Daylight low-tide windows
          </h1>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-[var(--text-dim)]">
            {/*
              A JSX text node spanning several lines loses its LEADING space, so
              `{HORIZON_DAYS} days` renders as "7days" and a following text line
              butts straight up against the expression before it. Each number is
              therefore bound to its unit inside one expression, and every seam
              between an expression and a text node is an explicit {' '}.
            */}
            {`${rows.length} reef and tidepool spots over ${HORIZON_DAYS} days.`}{' '}
            Each cell gives the low (▼) and the high that follows it (▲), light when that low
            falls in daylight and dark when it does not: today&apos;s column is the next low from
            now, later days that day&apos;s best daylight low.{' '}
            {`A window needs ${MIN_WINDOW_MINUTES} minutes to count, and that judgement sits behind the badge on each cell.`}
          </p>
        </div>

        <nav aria-label="Sort order" className="flex items-center gap-1 text-xs">
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
              <th scope="col" className="w-[11rem] px-1.5 pb-2 text-[0.7rem] font-medium text-[var(--text-dimmer)]">
                Spot
              </th>
              {grid.days.map((date, i) => (
                <th
                  key={formatLocalDate(date)}
                  scope="col"
                  className={[
                    'px-1.5 pb-2 text-[0.7rem] font-medium',
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
              ribbon={
                <WeekRibbon
                  spot={row.spot}
                  days={row.days}
                  dates={grid.days}
                  timeZone={grid.timeZone}
                  swell={row.swell}
                  ceiling={row.ceiling}
                />
              }
            />
          ))}
        </table>
      </div>

      <Legend />

      <p className="mt-4 max-w-prose text-xs leading-relaxed text-[var(--text-dimmer)] wide:hidden">
        Showing today only. The full week is on each spot&apos;s own page.
      </p>

      <Excluded names={grid.excludedSpotNames} />

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

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.7rem] text-[var(--text-dim)]">
        <span
          data-lighting="day"
          className="cell-skin rounded border px-1.5 py-0.5 font-mono text-[0.68rem]"
        >
          ▼ 0.2 1:14 pm
        </span>
        <span>low in daylight</span>
        <span aria-hidden className="text-[var(--text-dimmer)]">
          ·
        </span>
        <span
          data-lighting="night"
          className="cell-skin rounded border px-1.5 py-0.5 font-mono text-[0.68rem]"
        >
          ▼ 0.2 4:41 am
        </span>
        <span>low after dark</span>
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-[0.7rem] text-[var(--text-dimmer)]">
          What the flag on each cell means
        </summary>
        <p className="mt-1.5 max-w-prose text-[0.7rem] leading-relaxed text-[var(--text-dimmer)]">
          Every cell carries an <span className="font-mono">i</span> badge. Opening it gives one of
          these six, with the sentence behind it. They are kept closed because each one is decided
          against a floor and a swell ceiling that are author estimates, never field-checked — the
          tide and the clock in the cell are the measured part.
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.7rem]">
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
      <summary className="cursor-pointer text-xs text-[var(--text-dimmer)]">
        {names.length} spots are not in this grid
      </summary>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--text-dimmer)]">
        These carry no <code>tidepool_floor_ft</code> in spots.json. A null floor is unresolved,
        not zero, and a window cannot be computed without one. Estimating floors to fill the grid
        out would put a hand-typed number where a measurement belongs.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-dimmer)]">{names.join(' · ')}</p>
    </details>
  );
}
