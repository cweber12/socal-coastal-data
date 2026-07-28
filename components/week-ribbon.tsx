import Link from 'next/link';

import { FlagBadge } from '@/components/flag-badge';
import { CellShell, TideLine } from '@/components/window-cell';
import { cellAriaLabel, flagBadgeLabel, thresholdDisclosure } from '@/lib/labels';
import { formatDayMonth, formatLocalDate, formatWeekdayShort, type LocalDate } from '@/lib/time';
import { lowLighting, type WindowResult } from '@/lib/windows';
import type { SwellCeiling } from '@/lib/thresholds';
import type { SpotSwell } from '@/lib/upstream';
import type { TidepoolSpot } from '@/shared/spots.generated';

/**
 * A spot's week at a glance.
 *
 * Shared verbatim between the grid's inline row disclosure and /spot/[slug], so
 * expanding a row and navigating to the spot page show the same thing rather than
 * two views that drift apart.
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
}: {
  spot: TidepoolSpot;
  days: readonly (WindowResult | null)[];
  dates: readonly LocalDate[];
  timeZone: string;
  swell: SpotSwell;
  ceiling: SwellCeiling;
  showSpotLink?: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          {showSpotLink ? (
            <Link href={`/spot/${spot.slug}`}>{spot.name}</Link>
          ) : (
            spot.name
          )}
          <span className="ml-2 text-xs font-normal text-[var(--text-dimmer)]">
            {spot.lat.toFixed(3)}, {spot.lon.toFixed(3)}
          </span>
        </h3>
        <p className="text-xs text-[var(--text-dimmer)]">
          {thresholdDisclosure(
            spot.tidepool_floor_ft,
            spot.tidepool_floor_confidence,
            ceiling.ceilingFt,
            ceiling.confidence,
          )}
        </p>
      </div>

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
          const dateMs = result?.lowMs ?? null;

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
                  className="rounded border border-dashed border-[var(--border-strong)] px-2 py-1.5 text-[0.7rem] text-[var(--text-dimmer)]"
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
                  href={`/spot/${spot.slug}/${dateKey}`}
                  className="cell-link block rounded py-1.5 pl-2 pr-6 text-[0.7rem] no-underline transition-colors"
                  aria-label={cellAriaLabel(spot.name, result, timeZone)}
                >
                  <span aria-hidden className="block">
                    {heading}
                    <span className="mt-1 block">
                      <TideLine
                        arrow="▼"
                        heightFt={result.lowFt}
                        tMs={result.lowMs}
                        timeZone={timeZone}
                        emphasis
                      />
                      {result.nextHighMs !== null && result.nextHighFt !== null ? (
                        <TideLine
                          arrow="▲"
                          heightFt={result.nextHighFt}
                          tMs={result.nextHighMs}
                          timeZone={timeZone}
                        />
                      ) : null}
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

/**
 * Where the swell number came from.
 *
 * spots.json's schema requires the UI to disclose a fallback substitution, since
 * a fallback "may be geographically distant". A null reading says unknown, never
 * calm.
 */
export function SwellProvenance({
  swell,
  ceiling,
}: {
  swell: SpotSwell;
  ceiling: SwellCeiling;
}) {
  return (
    <p className="mt-2 text-xs leading-relaxed text-[var(--text-dimmer)]">
      {swell.swellFt === null ? (
        <>
          <strong>Swell unknown.</strong> No buoy in this spot&apos;s binding is delivering a
          wave height, so no day can read as a pass. Unknown is not calm.
        </>
      ) : (
        <>
          Swell {swell.swellFt.toFixed(1)} ft from {swell.sourceBuoyId}{' '}
          ({swell.sourceBuoyName})
          {swell.ageMinutes !== null ? `, ${Math.round(swell.ageMinutes)} min old` : ''}
          {swell.substituted ? (
            <>
              . <strong>Substituted:</strong> this spot&apos;s primary buoy is not delivering,
              so a fallback is standing in. It may be geographically distant and read
              differently for the same conditions
            </>
          ) : null}
          {swell.intendedBuoyId && swell.intendedBuoyId !== swell.sourceBuoyId ? (
            <>
              . The buoy that should serve this spot is {swell.intendedBuoyId}, which is marked
              dead
            </>
          ) : null}
          . Against an {ceiling.confidence} ceiling of {ceiling.ceilingFt.toFixed(1)} ft
          {ceiling.isDefault ? ' (corridor default, no per-spot calibration)' : ''}.
        </>
      )}
    </p>
  );
}
