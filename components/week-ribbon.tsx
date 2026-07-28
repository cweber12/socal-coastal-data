import Link from 'next/link';

import { formatHeight, thresholdDisclosure } from '@/lib/labels';
import { formatClock, formatDayMonth, formatLocalDate, formatWeekdayShort, type LocalDate } from '@/lib/time';
import { STATE_PRESENTATION, type WindowResult } from '@/lib/windows';
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
        {dates.map((date, i) => {
          const result = days[i] ?? null;
          const presentation = result ? STATE_PRESENTATION[result.state] : null;
          const dateMs = result?.lowMs ?? null;

          return (
            <li key={formatLocalDate(date)} className="min-w-[5.5rem] flex-1">
              <Link
                href={`/spot/${spot.slug}/${formatLocalDate(date)}`}
                className="state-tint block rounded border px-2 py-1.5 text-[0.7rem] no-underline"
                style={
                  presentation
                    ? { ['--state' as string]: presentation.colorVar }
                    : { ['--state' as string]: 'var(--border-strong)' }
                }
                aria-label={
                  result
                    ? `${spot.name}, ${formatWeekdayShort(result.lowMs, timeZone)} ${formatDayMonth(result.lowMs, timeZone)}: ` +
                      `${presentation!.spoken}. ${result.reason} Select for the day chart.`
                    : `${spot.name}, day ${i + 1}: not evaluated.`
                }
              >
                <span aria-hidden className="block">
                  <span className="block font-medium text-[var(--text-dim)]">
                    {dateMs !== null
                      ? `${formatWeekdayShort(dateMs, timeZone)} ${formatDayMonth(dateMs, timeZone)}`
                      : `${date.month}/${date.day}`}
                  </span>
                  {result && presentation ? (
                    <>
                      <span
                        className="mt-1 flex items-center gap-1 font-medium"
                        style={{ color: presentation.colorVar }}
                      >
                        <span className="leading-none">{presentation.glyph}</span>
                        <span className="truncate">{presentation.label}</span>
                      </span>
                      <span className="mt-0.5 block font-mono tabular-nums">
                        {formatHeight(result.lowFt)} {formatClock(result.lowMs, timeZone)}
                      </span>
                    </>
                  ) : (
                    <span className="mt-1 block text-[var(--text-dimmer)]">not evaluated</span>
                  )}
                </span>
              </Link>
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
