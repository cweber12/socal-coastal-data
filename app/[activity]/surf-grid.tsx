import Link from 'next/link';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/core/components/disclosure';
import { MidnightNotice } from '@/core/components/midnight-notice';
import { SpotRow } from '@/core/components/spot-row';
import { UnresolvedDisclosure } from '@/core/components/unresolved';
import { UNRESOLVED_SOURCES } from '@/app/unresolved-sources';
import { SpotDisclosure } from '@/activities/surf/components/spot-summary';
import { SessionCell, UnevaluatedCell } from '@/activities/surf/components/session-cell';
import {
  HORIZON_DAYS,
  loadSurfGrid,
  sortRows,
  type SortKey,
  type SurfGridData,
} from '@/activities/surf/grid';
import { rowAriaLabel } from '@/activities/surf/labels';
import { surfGridPath } from '@/activities/surf/routes';
import { MIN_SESSION_MINUTES, SWELL_HORIZON_DAYS } from '@/activities/surf/policy';
import { STATE_PRESENTATION, SURF_STATES } from '@/activities/surf/states';
import { SURF_SWELL_MINIMUM, SURF_THRESHOLDS_VERSION, SURF_TIDE_BAND } from '@/activities/surf/thresholds';
import {
  formatDateLong,
  formatDayMonth,
  formatLocalDate,
  formatWeekdayShort,
  startOfLocalDay,
} from '@/core/time';
import { SPOTS_VERSION, TIDE_DATUM } from '@/shared/spots.generated';

/**
 * The surf verdict grid.
 *
 * Lives in app/ beside the tidepool grid rather than under activities/surf/,
 * for the reason ADR 0010 gives and app/activities.ts restates: composition
 * ACROSS activities belongs to the composition root, and a page that renders one
 * activity's grid inside a route segment shared with another is doing exactly
 * that. Everything it composes -- the predicate, the states, the labels, the
 * cell -- is surf's and is imported from there.
 *
 * ---------------------------------------------------------------------------
 * The disclosure on this page is louder than tidepool's, on purpose
 * ---------------------------------------------------------------------------
 *
 * Tidepool rests on a measured floor with an evidence ledger and an instrument
 * path to `verified`. Nothing here does. The band, the ceiling and the minimum
 * are all uncalibrated author estimates, the surf zone holds no measured fact at
 * all, and membership means "a buoy reports waves here" rather than "this is a
 * surf break". Three sentences a reader cannot get by looking, so three
 * sentences are on the page.
 */
export async function SurfGrid({ sort }: { sort: SortKey }) {
  const now = Date.now();
  const grid = await loadSurfGrid(now);

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
   * Derived, never hardcoded. Every surf-zone spot binds 9410230 today, which is
   * why every row shows the same sessions -- and saying so is what turns that
   * from an apparent bug into a stated fact. It is a fact about the current
   * contents of spots.json, not about the corridor, so the copy falls back when
   * the set is not a singleton.
   */
  const stations = new Set(rows.map((r) => r.spot.tide_station));
  const sharedStation = stations.size === 1 ? [...stations][0] : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-title font-semibold tracking-tight">Tide windows for surf</h1>
          <p className="mt-1 max-w-prose text-ui text-[var(--text-dim)]">
            {`${rows.length} spots over ${HORIZON_DAYS} days, against one uncalibrated tide band of ${SURF_TIDE_BAND.minFt.toFixed(1)}–${SURF_TIDE_BAND.maxFt.toFixed(1)} ft.`}{' '}
            {sharedStation ? (
              <>
                {`All of them read tide station ${sharedStation}, so the tide is the same down the
                  whole corridor — what differs is each spot's swell ceiling, and every cell shows
                  the sessions the band produced rather than a single window.`}
              </>
            ) : (
              <>
                Each cell gives the stretches of the day when the tide sits inside the band, with
                how much of each is usable after daylight and any gate.
              </>
            )}
          </p>
        </div>

        <nav aria-label="Sort order" className="flex items-center gap-1 text-ui">
          <span className="mr-1 text-[var(--text-dimmer)]">Sort</span>
          <SortLink current={sort} value="usable" label="Usable days" />
          <SortLink current={sort} value="geographic" label="North to south" />
        </nav>
      </div>

      {/*
        The caveat first, above the grid, and not behind a summary.

        Every other disclosure on this page is collapsed, matching how the repo
        demotes anything resting on an uncalibrated number. This one is not,
        because it is not a caveat about precision -- it is a statement about
        what the grid below is a grid OF. A reader who takes these 24 rows for 24
        surf breaks has misread the whole page, and no amount of accuracy in the
        cells would fix that.
      */}
      <p className="mt-3 max-w-prose rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-ui text-[var(--text-dim)]">
        <strong>These are tide and buoy readings, not surf reports.</strong> A spot is in this grid
        because <code>shared/spots.json</code> binds it a wave buoy, which means this stack can read
        a wave height there — not that it is a surf break. Oceanside Harbor is a harbor mouth and
        Silver Strand is a sand barrier, and both are here. The wave height is the buoy&apos;s
        significant wave height, offshore or nearshore, with no shoaling or refraction transform
        applied anywhere: it is <em>not</em> the height of the wave at the break.
      </p>

      <div className="grid-scroller mt-4">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="sr-only">
            Surf tide windows by spot and day. Each spot&apos;s name expands to its thresholds and
            swell provenance; each day links to that day&apos;s tide chart.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[11rem] px-1.5 pb-2 text-meta font-medium text-[var(--text-dimmer)]"
              >
                Spot
              </th>
              {grid.days.map((date, i) => (
                <th
                  key={formatLocalDate(date)}
                  scope="col"
                  className={[
                    'px-1.5 pb-2 text-meta font-medium',
                    i === 0
                      ? 'text-[var(--text)]'
                      : 'hidden text-[var(--text-dimmer)] wide:table-cell',
                  ].join(' ')}
                >
                  <span className="block">
                    {i === 0 ? 'Today' : formatWeekdayShort(dayStarts[i]!, grid.timeZone)}
                  </span>
                  <span className="block font-normal text-[var(--text-dimmer)]">
                    {formatDayMonth(dayStarts[i]!, grid.timeZone)}
                  </span>
                  {/*
                    Past the swell horizon. It bites harder on this grid than on
                    tidepool's: swell is one of four inputs to a tidepool verdict
                    and half of a surf one, so the last two columns here are tide
                    geometry with no judgement attached at all.
                  */}
                  {i >= SWELL_HORIZON_DAYS ? (
                    <span
                      className="block font-normal text-[var(--text-dimmer)]"
                      title={`Past the ${SWELL_HORIZON_DAYS}-day swell horizon: there is no swell forecast in this stack, only a live buoy reading, so no day beyond it can read as a pass.`}
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
              /*
                The ceiling leads, ahead of the usable count.

                Same argument the tidepool grid makes for leading with the floor,
                pointed at the number that actually varies here. Every surf-zone
                spot reads the same tide station, so the sessions to the right
                are identical down the column; what differs per spot is the
                ceiling, and it is 3.0 ft everywhere except Black's at 2.0 and
                Tourmaline at 4.0. A reader who cannot see which one this row was
                judged against cannot tell why two identical tides gave two
                different verdicts.
              */
              subtitle={`ceiling ${row.ceiling.ceilingFt.toFixed(1)} ft · ${
                row.usableCount === 0 ? 'no usable days' : `${row.usableCount} usable`
              }`}
              rowLabel={rowAriaLabel(row.spot.name, row.usableCount, HORIZON_DAYS)}
              columnCount={grid.days.length + 1}
              cells={row.days.map((result, i) =>
                result ? (
                  <SessionCell
                    key={i}
                    spotSlug={row.spot.slug}
                    spotName={row.spot.name}
                    day={result}
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
                Kept small on purpose. This is a prop on a client component, so
                it is serialised into the flight payload for every row on every
                request whether or not anybody expands one -- and this grid has
                24 rows to tidepool's 8, which is the lesson PR #18 left in
                core/components/spot-row.tsx multiplied by three.
              */
              detail={
                <SpotDisclosure spot={row.spot} swell={row.swell} ceiling={row.ceiling} />
              }
            />
          ))}
        </table>
      </div>

      <Legend />

      <p className="mt-4 max-w-prose text-meta text-[var(--text-dimmer)]">
        Showing today only below 600px. Each day links to its own chart, where the band is drawn
        against the curve.
      </p>

      <Excluded excluded={grid.excluded} membership={grid.membership} />

      <UnresolvedDisclosure sources={UNRESOLVED_SOURCES} />

      <Notices notices={grid.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={grid.evaluatedAtMs}
          timeZone={grid.timeZone}
          extra={`spots.json ${SPOTS_VERSION} · surf thresholds ${SURF_THRESHOLDS_VERSION} · datum ${TIDE_DATUM} · ${formatDateLong(dayStarts[0]!, grid.timeZone)}`}
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
      // This activity's own grid, from this activity's own route helper. A sort
      // link that reached another activity's grid would change the verdicts
      // under a control that claims to change only their order -- which is a
      // live hazard now that there are two grids rather than a hypothetical one.
      href={value === 'usable' ? surfGridPath() : `${surfGridPath()}?sort=${value}`}
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

/** The key. What a cell says always visible; what the states mean, collapsed. */
function Legend() {
  return (
    <section aria-labelledby="surf-key-heading" className="mt-4">
      <h2 id="surf-key-heading" className="sr-only">
        How to read this grid
      </h2>

      <p className="max-w-prose text-meta text-[var(--text-dim)]">
        Each row inside a cell is one session — a stretch of the day with the tide inside the band —
        with the clock range on the left and the usable time after daylight and any gate on the
        right. A lighter row is a session in daylight and a darker one is after dark; the lighting
        is per session, because a day often gives one of each.{' '}
        <span className="font-mono">‹</span> means the session was already running at midnight and{' '}
        <span className="font-mono">›</span> that it was still running at the next one. The bold row
        is the one the day&apos;s verdict is about.{' '}
        {`A session needs ${MIN_SESSION_MINUTES} minutes to count, and that judgement sits behind the badge on each cell.`}
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
          What the flag on each cell means
        </summary>
        <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
          Every cell carries an <span className="font-mono">i</span> badge. Opening it gives one of
          these eight, with the sentence behind it. They are kept closed because each one is decided
          against a tide band, a swell ceiling and a swell minimum that are author estimates, never
          field-checked, over a zone this stack holds no measured fact about — the tide and the
          clock in the cell are the measured part.
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-meta">
          {SURF_STATES.map((state) => {
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

function legendGloss(state: (typeof SURF_STATES)[number]): string {
  switch (state) {
    case 'go':
      return `${MIN_SESSION_MINUTES}+ min in daylight, swell inside the window`;
    case 'brief':
      return `no session reaches ${MIN_SESSION_MINUTES} min`;
    case 'veto':
      return 'swell over the ceiling';
    case 'flat':
      return `swell under ${SURF_SWELL_MINIMUM.ft.toFixed(1)} ft — nothing to ride, not a warning`;
    case 'closed':
      return 'every session falls outside the operator’s gate hours';
    case 'dark':
      return 'every session falls outside the daylight left';
    case 'out-of-band':
      return 'the tide never sits inside the band';
    case 'swell-tbd':
      return 'swell unknown — never a pass';
  }
}

/**
 * The spots this grid does not cover.
 *
 * Two spots, one bucket, and the arithmetic shown rather than implied. The
 * tidepool grid's equivalent has eighteen exclusions across two buckets and
 * needs the split to avoid calling a harbor an unsurveyed reef; here both
 * exclusions are the same kind, and the section exists anyway because a reader
 * seeing 24 rows cannot tell whether 26 is the whole coast.
 */
function Excluded({
  excluded,
  membership,
}: {
  excluded: SurfGridData['excluded'];
  membership: SurfGridData['membership'];
}) {
  if (excluded.length === 0) return null;

  const accounted = membership.members + membership.notInZone + membership.unresolved;
  const complete = accounted === membership.inventory;

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
        {excluded.length} spots are not in this grid
      </summary>

      <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
        {complete ? (
          <>
            {membership.members} of {membership.inventory} spots are bound to a wave buoy and are in
            the grid above. The other {excluded.length} are below, and every spot in the inventory is
            in exactly one of the two groups.
          </>
        ) : (
          // Never reached while every spot lands in one of two buckets. Present
          // because a count that silently fails to add up is the thing being
          // guarded against, and it must not be invisible if it happens.
          <strong>
            {accounted} of {membership.inventory} spots are accounted for.{' '}
            {membership.inventory - accounted} are in no group at all, which is a bug in
            core/zones/surf.ts and not a fact about the coast.
          </strong>
        )}
      </p>

      <section className="mt-3">
        <h3 className="text-meta font-semibold tracking-wide uppercase text-[var(--text-dim)]">
          No wave binding{' '}
          <span className="font-normal normal-case tracking-normal text-[var(--text-dimmer)]">
            {excluded.length} {excluded.length === 1 ? 'spot' : 'spots'}
          </span>
        </h3>
        <p className="mt-1 max-w-prose text-meta text-[var(--text-dimmer)]">
          Nothing in this stack reports a wave height at these coordinates. They are not spots whose
          surf is unmeasured — the binding is a deliberate null, and no ceiling will be set for them.
        </p>
        <dl className="mt-1.5 space-y-1.5 text-meta text-[var(--text-dimmer)]">
          {excluded.map(({ spot, reason }) => (
            <div key={spot.slug}>
              <dt className="font-medium text-[var(--text-dim)]">{spot.name}</dt>
              <dd className="max-w-prose">{reason}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="tint-panel-source mt-3 text-meta">
        Membership is derived from <code>wave.primary</code> and <code>wave.fallback</code> in{' '}
        <code>shared/spots.json</code> by <code>core/zones/surf.ts</code>. There is no hand-written
        surf membership list, and the reasons above are that module&apos;s own words rather than a
        file&apos;s.
      </p>
    </details>
  );
}
