import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SurfDayChart } from '@/activities/surf/components/day-chart';
import { EvaluationStamp, Notices, UpstreamFailure } from '@/core/components/disclosure';
import { FlagBadge } from '@/activities/surf/components/flag-badge';
import { SwellProvenance } from '@/activities/surf/components/spot-summary';
import { UnresolvedDisclosure } from '@/core/components/unresolved';
import { UNRESOLVED_SOURCES } from '@/app/unresolved-sources';
import {
  isServableDate,
  loadSurfSpotDay,
  servableDateParam,
  surfSpotBySlug,
} from '@/activities/surf/grid';
import {
  describeSessionCount,
  flagBadgeLabel,
  formatHeight,
  thresholdDisclosure,
} from '@/activities/surf/labels';
import { MIN_SESSION_MINUTES } from '@/activities/surf/policy';
import { surfDayPath, surfGridPath } from '@/activities/surf/routes';
import {
  SURF_SWELL_MINIMUM,
  SURF_THRESHOLDS_VERSION,
  SURF_TIDE_BAND,
} from '@/activities/surf/thresholds';
import {
  addLocalDays,
  formatClock,
  formatDateLong,
  formatDuration,
  formatLocalDate,
  localDateInZone,
  sameLocalDate,
} from '@/core/time';
import { DISPLAY_TIME_ZONE, SPOTS_VERSION, TIDE_DATUM } from '@/shared/spots.generated';

/**
 * One spot, one day, for surf.
 *
 * The page the grid's cells link to, and the reason #129 built both routes
 * rather than the grid alone: a cell showing two sessions is a summary of a
 * shape, and the shape is only legible against the curve. It is also where the
 * band earns its drawing -- a horizontal region rather than two thresholds. See
 * activities/surf/components/day-chart.tsx.
 */
export async function SurfDay({ slug, dateParam }: { slug: string; dateParam: string }) {
  const spot = surfSpotBySlug(slug);
  if (!spot) notFound();

  const now = Date.now();

  /*
   * A route segment is untrusted input, and this rejects on two separate
   * grounds. `2026-02-30` parses as a Date in JS and rolls to 2 March, which
   * would silently chart a different day than the URL names. And a date outside
   * the servable window is refused here, BEFORE loadSurfSpotDay, so an
   * out-of-range request costs a 404 and never becomes a CO-OPS fetch.
   */
  const date = servableDateParam(dateParam, now);
  if (!date) notFound();

  const result = await loadSurfSpotDay(spot, date, now);
  const dayLabel = formatDateLong(result.dayStartMs, result.timeZone);
  const today = localDateInZone(now, DISPLAY_TIME_ZONE);
  const isToday = sameLocalDate(today, date);

  // The nav must not offer a link the route will refuse. At each bound the arrow
  // is dropped rather than rendered dead, so nothing on the page points at a 404.
  const previous = addLocalDays(date, -1);
  const next = addLocalDays(date, 1);
  const hasPrevious = isServableDate(previous, today);
  const hasNext = isServableDate(next, today);
  const day = result.day;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-ui">
        {/* Up to the grid this day came from, which is THIS activity's grid. */}
        <Link href={surfGridPath()}>All spots</Link>
        <span aria-hidden className="mx-1.5 text-[var(--text-dimmer)]">/</span>
        <Link href={`/spot/${spot.slug}`}>{spot.name}</Link>
        <span aria-hidden className="mx-1.5 text-[var(--text-dimmer)]">/</span>
        <span className="text-[var(--text-dim)]">{formatLocalDate(date)}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-title font-semibold tracking-tight">
            {spot.name}
            <span className="ml-2 text-section font-normal text-[var(--text-dim)]">{dayLabel}</span>
            {isToday ? (
              <span className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-meta font-medium tracking-wide uppercase text-[var(--text-dim)]">
                today
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-meta text-[var(--text-dimmer)]">
            {thresholdDisclosure(
              SURF_TIDE_BAND,
              SURF_TIDE_BAND.confidence,
              result.ceiling.ceilingFt,
              result.ceiling.confidence,
              SURF_SWELL_MINIMUM.ft,
              SURF_SWELL_MINIMUM.confidence,
            )}
          </p>
        </div>

        <nav aria-label="Nearby days" className="flex items-center gap-1 text-ui">
          {hasPrevious ? (
            <Link
              href={surfDayPath(spot.slug, previous)}
              className="rounded border border-[var(--border)] px-2 py-1 no-underline"
            >
              ← {previous.month}/{previous.day}
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              href={surfDayPath(spot.slug, next)}
              className="rounded border border-[var(--border)] px-2 py-1 no-underline"
            >
              {next.month}/{next.day} →
            </Link>
          ) : null}
          {!hasPrevious || !hasNext ? (
            <span className="text-[var(--text-dimmer)]">
              {`This is as far ${hasPrevious ? 'forward' : 'back'} as charts go.`}
            </span>
          ) : null}
        </nav>
      </div>

      {result.failure ? (
        <div className="mt-4">
          <UpstreamFailure failure={result.failure} what="Tide predictions" />
        </div>
      ) : (
        <>
          {/*
            The day's facts, untinted. The verdict is one badge in the corner,
            in the same place and with the same glyph as every badge in the grid.
          */}
          {day ? (
            <div className="relative mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 pr-10">
              <FlagBadge
                id="day"
                label={flagBadgeLabel(spot.name, day, result.timeZone)}
                day={day}
                className="absolute right-2.5 top-2.5"
              />

              <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-data wide:grid-cols-4">
                <Fact label="Sessions" value={describeSessionCount(day)} />
                <Fact
                  label="Best"
                  value={
                    day.best && day.best.usableEndMs > day.best.usableStartMs
                      ? `${formatClock(day.best.usableStartMs, result.timeZone)}–${formatClock(day.best.usableEndMs, result.timeZone)}`
                      : 'none usable'
                  }
                />
                <Fact
                  label={day.isToday ? 'Remaining' : 'Usable'}
                  value={
                    day.best
                      ? formatDuration(
                          day.isToday
                            ? (day.best.minutesRemaining ?? 0)
                            : day.best.usableMinutes,
                        )
                      : '—'
                  }
                />
                <Fact
                  label="Day range"
                  value={`${formatHeight(day.dayLowFt)}–${formatHeight(day.dayHighFt)} ft`}
                />
              </dl>
            </div>
          ) : null}

          <div className="mt-4">
            <SurfDayChart
              daySeries={result.daySeries}
              extrema={result.extrema}
              day={day}
              band={{ minFt: SURF_TIDE_BAND.minFt, maxFt: SURF_TIDE_BAND.maxFt }}
              dayStartMs={result.dayStartMs}
              dayEndMs={result.dayEndMs}
              timeZone={result.timeZone}
              nowMs={now}
              isToday={isToday}
              spotName={spot.name}
              dateLabel={dayLabel}
            />
          </div>

          <div className="mt-4 max-w-prose">
            <SwellProvenance swell={result.swell} ceiling={result.ceiling} />
            <p className="mt-2 text-meta text-[var(--text-dimmer)]">
              {`A session needs ${MIN_SESSION_MINUTES} minutes to count. There is no flood-side trim here: tidepool trims one because the water is returning over a reef somebody is standing on and a return route that was dry can close, which is a fact about being on foot on a ledge system rather than about the tide.`}
            </p>
            {/*
              The band's own reason, verbatim from the file.

              This is the page where the band decides something visible -- the
              chart draws it and the table counts sessions off it -- so the
              sentence explaining that it is one range for twenty-four spots
              belongs here rather than only in the collapsed disclosure below.
            */}
            <p className="mt-2 text-meta text-[var(--text-dimmer)]">{SURF_TIDE_BAND.reason}</p>
          </div>
        </>
      )}

      <UnresolvedDisclosure sources={UNRESOLVED_SOURCES} />

      <Notices notices={result.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={result.evaluatedAtMs}
          timeZone={result.timeZone}
          extra={
            `spots.json ${SPOTS_VERSION} · surf thresholds ${SURF_THRESHOLDS_VERSION} · ` +
            `datum ${TIDE_DATUM} · station ${spot.tide_station} · ` +
            `${result.daySeries.samples.length} samples`
          }
        />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta tracking-wide uppercase text-[var(--text-dimmer)]">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums">{value}</dd>
    </div>
  );
}
