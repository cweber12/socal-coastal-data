import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { routedActivity } from '@/app/activities';
import { DayChart } from '@/activities/tidepool/components/day-chart';
import { EvaluationStamp, Notices, UpstreamFailure } from '@/core/components/disclosure';
import { FlagBadge } from '@/activities/tidepool/components/flag-badge';
import { RateRefusal } from '@/activities/tidepool/components/rate-panel';
import { SwellProvenance } from '@/activities/tidepool/components/spot-summary';
import { SurfDay } from '@/app/[activity]/[slug]/[date]/surf-day';
import { surfSpotBySlug } from '@/activities/surf/grid';
import { UnresolvedDisclosure } from '@/core/components/unresolved';
import { UNRESOLVED_SOURCES } from '@/app/unresolved-sources';
import { calibrationFor, CALIBRATION_PULLED_AT, TAXA_VERSION } from '@/activities/tidepool/calibration';
import TARGET_TAXA from '@/shared/target_taxa.json';
import { isServableDate, loadSpotDay, servableDateParam, tidepoolSpotBySlug } from '@/activities/tidepool/grid';
import { describeWindowLength, flagBadgeLabel, formatHeight, thresholdDisclosure } from '@/activities/tidepool/labels';
import { tidepoolDayPath, tidepoolGridPath } from '@/activities/tidepool/routes';
import {
  addLocalDays,
  formatClock,
  formatDateLong,
  formatDuration,
  formatLocalDate,
  localDateInZone,
  sameLocalDate,
} from '@/core/time';
import { MIN_WINDOW_MINUTES } from '@/activities/tidepool/policy';
import { DISPLAY_TIME_ZONE, SPOTS_VERSION, TIDE_DATUM } from '@/shared/spots.generated';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ activity: string; slug: string; date: string }>;
}): Promise<Metadata> {
  const { activity: segment, slug, date } = await params;
  /*
   * The activity is checked here as well as in the page, because metadata is
   * generated for a request the page then 404s. Without this, `/kayak/x/y`
   * returns a not-found page carrying a confident title naming a real spot.
   *
   * And the slug is resolved through THAT activity's zone, not through
   * tidepool's for every segment. `/surf/oceanside-pier/<date>` is a real page
   * and `/tidepool/oceanside-pier/<date>` is a 404, because the pier is in the
   * surf zone and not the intertidal -- so a shared lookup would have titled one
   * of them "Not found" while it rendered, and given the other a confident title
   * for a page that 404s. The two zones overlap without either containing the
   * other; eight spots are in both, sixteen in surf alone.
   */
  const activity = routedActivity(segment);
  const spot =
    activity === null
      ? null
      : activity === 'surf'
        ? surfSpotBySlug(slug)
        : tidepoolSpotBySlug(slug);
  return {
    title: spot ? `${spot.name}, ${date} — tide chart` : 'Not found',
    /*
     * Not indexed, and not followed.
     *
     * app/robots.ts already disallows this path, but robots.txt is a request
     * and this is the belt to its braces. Every day page links to the day
     * either side of it, so a crawler that ignores robots.txt would otherwise
     * walk the chain out to the servable bound in both directions, once per
     * spot -- and each new date it reaches is a fresh CO-OPS request.
     *
     * There is nothing lost. A tide chart for one spot on one day is not a
     * search result anyone wants; the grid and the spot pages are, and both
     * stay indexable.
     */
    robots: { index: false, follow: false },
  };
}

/**
 * One activity's verdict for one spot on one day.
 *
 * The switch and the `never` after it are the same device as the grid route's,
 * for the same reason, and #129 is where both of them earned their keep: adding
 * `surf` to the registry broke this file's compilation until surf had a day page
 * of its own. See `app/[activity]/page.tsx` for the full argument.
 */
export default async function ActivityDayPage({
  params,
}: {
  params: Promise<{ activity: string; slug: string; date: string }>;
}) {
  const { activity: segment, slug, date: dateParam } = await params;
  const activity = routedActivity(segment);
  if (activity === null) notFound();

  switch (activity) {
    case 'tidepool':
      return <TidepoolDay slug={slug} dateParam={dateParam} />;
    case 'surf':
      return <SurfDay slug={slug} dateParam={dateParam} />;
  }

  const unrendered: never = activity;
  throw new Error(`Routed activity with no day page: ${String(unrendered)}`);
}

async function TidepoolDay({ slug, dateParam }: { slug: string; dateParam: string }) {
  const spot = tidepoolSpotBySlug(slug);
  if (!spot) notFound();

  const now = Date.now();

  /*
   * A route segment is untrusted input, and this rejects on two separate
   * grounds. `2026-02-30` parses as a Date in JS and rolls to 2 March, which
   * would silently chart a different day than the URL names. And a date outside
   * the servable window is refused here, BEFORE loadSpotDay, so an out-of-range
   * request costs a 404 and never becomes a CO-OPS fetch.
   */
  const date = servableDateParam(dateParam, now);
  if (!date) notFound();

  const day = await loadSpotDay(spot, date, now);
  const dayLabel = formatDateLong(day.dayStartMs, day.timeZone);
  const today = localDateInZone(now, DISPLAY_TIME_ZONE);
  const isToday = sameLocalDate(today, date);

  // The nav must not offer a link the route will refuse. At each bound the arrow
  // is dropped rather than rendered dead, so nothing on the page points at a 404.
  const previous = addLocalDays(date, -1);
  const next = addLocalDays(date, 1);
  const hasPrevious = isServableDate(previous, today);
  const hasNext = isServableDate(next, today);
  const result = day.window;

  /*
   * Read straight from the committed calibration. No network in this component,
   * and no fallback: `calibrationFor` returns null for a spot the pipeline never
   * ran against, and the discriminated union makes a refusal impossible to read
   * as a rate.
   */
  const calibration = calibrationFor(spot.slug);

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-ui">
        {/*
          Up to the grid this day came from, which is this activity's grid.

          Not `/`. The root is a redirect to the only routed activity today and
          becomes the corridor overview when #101's `app/page.tsx` lands; either
          way it is the top of the site, and what "All spots" means here is the
          seven-day grid one level up.
        */}
        <Link href={tidepoolGridPath()}>All spots</Link>
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
              spot.floorFt,
              spot.floorConfidence,
              day.ceiling.ceilingFt,
              day.ceiling.confidence,
            )}
          </p>
        </div>

        <nav aria-label="Nearby days" className="flex items-center gap-1 text-ui">
          {hasPrevious ? (
            <Link
              href={tidepoolDayPath(spot.slug, previous)}
              className="rounded border border-[var(--border)] px-2 py-1 no-underline"
            >
              ← {previous.month}/{previous.day}
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              href={tidepoolDayPath(spot.slug, next)}
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

      {day.failure ? (
        <div className="mt-4">
          <UpstreamFailure failure={day.failure} what="Tide predictions" />
        </div>
      ) : (
        <>
          {/*
            The day's facts, untinted.
            ------------------------------------------------------------------
            This panel used to lead with the state in its own colour across the
            full width -- red for a swell veto, amber for a brief window. At this
            size that is the loudest thing on the page, and what it is loud about
            is a verdict from an uncalibrated floor and a corridor-default
            ceiling. The four facts below are measurements; they now carry the
            panel on their own, and the verdict is one badge in the corner, in
            the same place and with the same glyph as every badge in the grid.
          */}
          {result ? (
            <div className="relative mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-3 pr-10">
              <FlagBadge
                id="day"
                label={flagBadgeLabel(spot.name, result, day.timeZone)}
                result={result}
                className="absolute right-2.5 top-2.5"
              />

              <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-data wide:grid-cols-4">
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
              floorFt={spot.floorFt}
              timeZone={day.timeZone}
              nowMs={now}
              isToday={isToday}
              spotName={spot.name}
              dateLabel={dayLabel}
              calibration={calibration}
              dayLowFt={day.dayLowFt}
              taxaCount={TARGET_TAXA.targets.length}
            />
          </div>

          {/*
            A refused spot renders no panel and says why, in words.

            Five of the eight refuse on the current corpus, so this is the common
            branch rather than the edge one. A default band or a corridor
            fallback here would be the null-rendering-as-a-pass failure
            spots.json warns about, and there is no accessor in
            activities/tidepool/calibration.ts
            that could produce one.
          */}
          {calibration && !calibration.published ? (
            <RateRefusal calibration={calibration} spotName={spot.name} />
          ) : null}

          <div className="mt-4 max-w-prose">
            <SwellProvenance swell={day.swell} ceiling={day.ceiling} />
            <p className="mt-2 text-meta text-[var(--text-dimmer)]">
              A window needs {MIN_WINDOW_MINUTES} minutes to count, and the flood side is trimmed
              to 60% of the time it takes the tide to come back up to the floor. The trim is a
              safety margin, not a measurement: on the flood the water is returning and a return
              route that was dry can close.
            </p>
          </div>
        </>
      )}

      {/*
        The day page is where the ceiling actually decides something -- the flag
        badge on this panel is where a swell veto gets explained -- so the
        caveats on that ceiling belong here rather than only on the grid.
      */}
      <UnresolvedDisclosure sources={UNRESOLVED_SOURCES} />

      <Notices notices={day.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={day.evaluatedAtMs}
          timeZone={day.timeZone}
          extra={
            `spots.json ${SPOTS_VERSION} · datum ${TIDE_DATUM} · station ${spot.tide_station} · ` +
            `${day.daySeries.samples.length} samples` +
            (calibration
              ? ` · calibration pulled ${CALIBRATION_PULLED_AT}, taxa ${TAXA_VERSION}`
              : '')
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
