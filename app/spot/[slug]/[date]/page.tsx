import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { DayChart } from '@/components/day-chart';
import { EvaluationStamp, Notices, UpstreamFailure } from '@/components/disclosure';
import { SwellProvenance } from '@/components/week-ribbon';
import { loadSpotDay, tidepoolSpotBySlug } from '@/lib/grid';
import { describeWindowLength, formatHeight, thresholdDisclosure } from '@/lib/labels';
import {
  addLocalDays,
  formatClock,
  formatDateLong,
  formatDuration,
  formatLocalDate,
  localDateInZone,
  sameLocalDate,
  startOfLocalDay,
  tryParseLocalDate,
} from '@/lib/time';
import { MIN_WINDOW_MINUTES, STATE_PRESENTATION } from '@/lib/windows';
import { DISPLAY_TIME_ZONE, SPOTS_VERSION, TIDE_DATUM } from '@/shared/spots.generated';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}): Promise<Metadata> {
  const { slug, date } = await params;
  const spot = tidepoolSpotBySlug(slug);
  return { title: spot ? `${spot.name}, ${date} — tide chart` : 'Not found' };
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const { slug, date: dateParam } = await params;

  const spot = tidepoolSpotBySlug(slug);
  if (!spot) notFound();

  /*
   * A route segment is untrusted input. `2026-02-30` parses as a Date in JS and
   * rolls to 2 March, which would silently chart a different day than the URL
   * names, so parsing rejects anything that does not round-trip.
   */
  const date = tryParseLocalDate(dateParam);
  if (!date) notFound();

  const now = Date.now();
  const day = await loadSpotDay(spot, date, now);
  const dayLabel = formatDateLong(day.dayStartMs, day.timeZone);
  const isToday = sameLocalDate(localDateInZone(now, DISPLAY_TIME_ZONE), date);

  const previous = addLocalDays(date, -1);
  const next = addLocalDays(date, 1);
  const result = day.window;
  const presentation = result ? STATE_PRESENTATION[result.state] : null;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-xs">
        <Link href="/">All spots</Link>
        <span aria-hidden className="mx-1.5 text-[var(--text-dimmer)]">/</span>
        <Link href={`/spot/${spot.slug}`}>{spot.name}</Link>
        <span aria-hidden className="mx-1.5 text-[var(--text-dimmer)]">/</span>
        <span className="text-[var(--text-dim)]">{formatLocalDate(date)}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            {spot.name}
            <span className="ml-2 font-normal text-[var(--text-dim)]">{dayLabel}</span>
            {isToday ? (
              <span className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide uppercase text-[var(--text-dim)]">
                today
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-xs text-[var(--text-dimmer)]">
            {thresholdDisclosure(
              spot.tidepool_floor_ft,
              spot.tidepool_floor_confidence,
              day.ceiling.ceilingFt,
              day.ceiling.confidence,
            )}
          </p>
        </div>

        <nav aria-label="Nearby days" className="flex items-center gap-1 text-xs">
          <Link
            href={`/spot/${spot.slug}/${formatLocalDate(previous)}`}
            className="rounded border border-[var(--border)] px-2 py-1 no-underline"
          >
            ← {previous.month}/{previous.day}
          </Link>
          <Link
            href={`/spot/${spot.slug}/${formatLocalDate(next)}`}
            className="rounded border border-[var(--border)] px-2 py-1 no-underline"
          >
            {next.month}/{next.day} →
          </Link>
        </nav>
      </div>

      {day.failure ? (
        <div className="mt-4">
          <UpstreamFailure failure={day.failure} what="Tide predictions" />
        </div>
      ) : (
        <>
          {result && presentation ? (
            <div
              className="state-tint mt-4 rounded-md border p-3"
              style={{ ['--state' as string]: presentation.colorVar }}
            >
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: presentation.colorVar }}>
                <span aria-hidden>{presentation.glyph}</span>
                {presentation.label}
              </p>
              <p className="mt-1 max-w-prose text-xs leading-relaxed">{result.reason}</p>

              <dl className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-1.5 text-xs wide:grid-cols-4">
                <Fact label="Low" value={`${formatHeight(result.lowFt)} ft at ${formatClock(result.lowMs, day.timeZone)}`} />
                <Fact
                  label="Next high"
                  value={
                    result.nextHighMs !== null && result.nextHighFt !== null
                      ? `${formatHeight(result.nextHighFt)} ft at ${formatClock(result.nextHighMs, day.timeZone)}`
                      : 'beyond the series'
                  }
                />
                <Fact
                  label="Window"
                  value={
                    result.reachesFloor && result.usableMinutes > 0
                      ? `${formatClock(result.usableStartMs, day.timeZone)}–${formatClock(result.usableEndMs, day.timeZone)} (${formatDuration(result.usableMinutes)})`
                      : 'none'
                  }
                />
                <Fact
                  label={result.isToday ? 'Remaining' : 'Daylight'}
                  value={
                    result.isToday
                      ? describeWindowLength(result)
                      : `${formatClock(result.sunriseMs, day.timeZone)}–${formatClock(result.sunsetMs, day.timeZone)}`
                  }
                />
              </dl>
            </div>
          ) : null}

          <div className="mt-4">
            <DayChart
              daySeries={day.daySeries}
              extrema={day.extrema}
              window={result}
              dayStartMs={day.dayStartMs}
              dayEndMs={day.dayEndMs}
              sunriseMs={result?.sunriseMs ?? day.dayStartMs}
              sunsetMs={result?.sunsetMs ?? day.dayEndMs}
              floorFt={spot.tidepool_floor_ft}
              timeZone={day.timeZone}
              nowMs={now}
              isToday={isToday}
              spotName={spot.name}
              dateLabel={dayLabel}
            />
          </div>

          <div className="mt-4 max-w-prose">
            <SwellProvenance swell={day.swell} ceiling={day.ceiling} />
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-dimmer)]">
              A window needs {MIN_WINDOW_MINUTES} minutes to count, and the flood side is trimmed
              to 60% of the time it takes the tide to come back up to the floor. The trim is a
              safety margin, not a measurement: on the flood the water is returning and a return
              route that was dry can close.
            </p>
          </div>
        </>
      )}

      <Notices notices={day.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={day.evaluatedAtMs}
          timeZone={day.timeZone}
          extra={`spots.json ${SPOTS_VERSION} · datum ${TIDE_DATUM} · station ${spot.tide_station} · ${day.daySeries.samples.length} samples`}
        />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.68rem] tracking-wide uppercase text-[var(--text-dimmer)]">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums">{value}</dd>
    </div>
  );
}
