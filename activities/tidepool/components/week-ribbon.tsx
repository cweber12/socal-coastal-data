import Link from 'next/link';

import { FlagBadge } from '@/activities/tidepool/components/flag-badge';
import { SpotHeader, SwellProvenance } from '@/activities/tidepool/components/spot-summary';
import { CellShell, FloorGap, TideLine } from '@/activities/tidepool/components/window-cell';
import { cellAriaLabel, flagBadgeLabel } from '@/activities/tidepool/labels';
import { formatDayMonth, formatLocalDate, formatWeekdayShort, type LocalDate } from '@/core/time';
import { lowLighting, type WindowResult } from '@/activities/tidepool/policy';
import { tidepoolDayPath } from '@/activities/tidepool/routes';
import type { SwellCeiling } from '@/core/thresholds';
import type { SpotSwell } from '@/core/upstream';
import type { IntertidalSpot } from '@/core/zones/intertidal';

/**
 * A spot's week at a glance.
 *
 * Used by /spot/[slug], where this strip IS the week view.
 *
 * NOT used by the grid's row disclosure any more. It was, and the seven cells
 * it drew there duplicated the seven the grid row already showed at that width
 * -- at a cost of 47% of the page's RSC payload, since a prop handed to a
 * client component is serialised whether the row is open or not. The grid row
 * now discloses SpotDisclosure in components/spot-summary.tsx, which carries
 * the parts a table row has nowhere to put. Both still share SpotHeader and
 * SwellProvenance, so the two views cannot drift on what they do have in common.
 *
 * Skipped below 600px. The caller hides it, because at that width the grid has
 * already collapsed to a single day column and a seven-day strip inside it would
 * either overflow or shrink past legibility. Hiding is done in CSS rather than by
 * measuring the viewport in JS, so the server and client render the same markup
 * and nothing jumps on hydration.
 */
export function WeekRibbon({
  spot,
  days,
  dates,
  timeZone,
  swell,
  ceiling,
  showSpotLink = true,
  nameOnPage = false,
}: {
  spot: IntertidalSpot;
  days: readonly (WindowResult | null)[];
  dates: readonly LocalDate[];
  timeZone: string;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  showSpotLink?: boolean;
  /** The host page already has the spot name as its h1. */
  nameOnPage?: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <SpotHeader spot={spot} ceiling={ceiling} showSpotLink={showSpotLink} nameOnPage={nameOnPage} />

      <ol className="flex list-none gap-1.5 overflow-x-auto pb-1">
        {/*
          Built from the same shell as a grid cell, and carrying the same things:
          the date, the low, the high after it, a light or dark background for
          whether that low is in daylight, and the state behind a badge. The two
          views answer one question and must not answer it differently.
        */}
        {dates.map((date, i) => {
          const result = days[i] ?? null;
          const dateKey = formatLocalDate(date);
          const dateMs = result?.detail.lowMs ?? null;

          const heading = (
            <span className="block font-medium text-[var(--cell-fg-dim,var(--text-dim))]">
              {dateMs !== null
                ? `${formatWeekdayShort(dateMs, timeZone)} ${formatDayMonth(dateMs, timeZone)}`
                : `${date.month}/${date.day}`}
            </span>
          );

          if (!result) {
            return (
              <li key={dateKey} className="min-w-[7rem] flex-1">
                <div
                  role="note"
                  aria-label={`${spot.name}, day ${i + 1}: not evaluated.`}
                  className="rounded border border-dashed border-[var(--border-strong)] px-2 py-1.5 text-ui text-[var(--text-dimmer)]"
                >
                  <span aria-hidden className="block">
                    {heading}
                    <span className="mt-1 block">not evaluated</span>
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li key={dateKey} className="min-w-[7rem] flex-1">
              <CellShell
                lighting={lowLighting(result)}
                badge={
                  <FlagBadge
                    id={`ribbon-${spot.slug}-${dateKey}`}
                    label={flagBadgeLabel(spot.name, result, timeZone)}
                    result={result}
                  />
                }
              >
                <Link
                  href={tidepoolDayPath(spot.slug, date)}
                  className="cell-link block rounded py-1.5 pl-2 pr-6 text-data no-underline transition-colors"
                  aria-label={cellAriaLabel(spot.name, result, timeZone)}
                >
                  <span aria-hidden className="block">
                    {heading}
                    <span className="mt-1 block">
                      <TideLine
                        arrow="▼"
                        heightFt={result.detail.lowFt}
                        tMs={result.detail.lowMs}
                        timeZone={timeZone}
                        emphasis
                      />
                      {result.detail.nextHighMs !== null && result.detail.nextHighFt !== null ? (
                        <TideLine
                          arrow="▲"
                          heightFt={result.detail.nextHighFt}
                          tMs={result.detail.nextHighMs}
                          timeZone={timeZone}
                        />
                      ) : null}
                      <FloorGap lowFt={result.detail.lowFt} floorFt={result.detail.floorFt} />
                    </span>
                  </span>
                </Link>
              </CellShell>
            </li>
          );
        })}
      </ol>

      <SwellProvenance swell={swell} ceiling={ceiling} />
    </div>
  );
}
