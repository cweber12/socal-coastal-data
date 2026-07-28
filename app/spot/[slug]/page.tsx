import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/components/disclosure';
import { FlagBadge } from '@/components/flag-badge';
import { MidnightNotice } from '@/components/midnight-notice';
import { WeekRibbon } from '@/components/week-ribbon';
import { SpotProtection } from '@/components/spot-protection';
import { UnresolvedDisclosure } from '@/components/unresolved';
import { CellShell, TideLine } from '@/components/window-cell';
import { loadSpotWeek, tidepoolSpotBySlug } from '@/lib/grid';
import { cellAriaLabel, flagBadgeLabel } from '@/lib/labels';
import { formatDateLong, formatLocalDate, startOfLocalDay } from '@/lib/time';
import { lowLighting } from '@/lib/windows';
import { SPOTS_VERSION, TIDE_DATUM, TIDEPOOL_SPOTS } from '@/shared/spots.generated';

export const dynamic = 'force-dynamic';

/** Only the eight evaluable spots have a page; the rest have no floor to compute against. */
export function generateStaticParams() {
  return TIDEPOOL_SPOTS.map((spot) => ({ slug: spot.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const spot = tidepoolSpotBySlug(slug);
  return {
    title: spot ? `${spot.name} — tide windows` : 'Spot not found',
  };
}

export default async function SpotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const spot = tidepoolSpotBySlug(slug);
  if (!spot) notFound();

  const now = Date.now();
  const week = await loadSpotWeek(spot, now);
  const dayStarts = week.dates.map((d) => startOfLocalDay(d, week.timeZone));

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-xs">
        <Link href="/">All spots</Link>
        <span aria-hidden className="mx-1.5 text-[var(--text-dimmer)]">
          /
        </span>
        <span className="text-[var(--text-dim)]">{spot.name}</span>
      </nav>

      <h1 className="mt-2 text-base font-semibold tracking-tight">{spot.name}</h1>
      <p className="mt-1 text-xs text-[var(--text-dim)]">
        {spot.audiences.join(' · ')} · tide station {spot.tide_station} · coordinates are ±100 m
      </p>

      {week.failure ? (
        <div className="mt-4">
          <UpstreamFailure failure={week.failure} what="Tide predictions" />
        </div>
      ) : (
        <div className="mt-4">
          {/*
            The same component the grid expands inline, so a row disclosure and this
            page cannot drift into two different answers. Skipped below 600px: a
            seven-day strip at that width either overflows or shrinks past reading,
            and the collapse is done in CSS so the server and client markup match.
          */}
          <div className="hidden wide:block">
            <WeekRibbon
              spot={spot}
              days={week.days}
              dates={week.dates}
              timeZone={week.timeZone}
              swell={week.swell}
              ceiling={week.ceiling}
              showSpotLink={false}
            />
          </div>

          {/*
            Below 600px, the week becomes a vertical list of days.

            This used to print `result.reason` in full against each date, which
            put the whole verdict -- the thing the grid now keeps behind a badge
            -- back on the page as its only content. It carries the same things a
            grid cell does instead: the low, the light, and the flag one tap away.
          */}
          <ol className="list-none space-y-1.5 wide:hidden">
            {week.dates.map((date, i) => {
              const dateKey = formatLocalDate(date);
              const result = week.days[i];
              const dayLabel = formatDateLong(dayStarts[i]!, week.timeZone);

              if (!result) {
                return (
                  <li key={dateKey}>
                    <div
                      role="note"
                      aria-label={`${spot.name}, ${dayLabel}: not evaluated.`}
                      className="flex items-baseline justify-between gap-3 rounded-md border border-dashed border-[var(--border-strong)] px-3 py-2 text-xs text-[var(--text-dimmer)]"
                    >
                      <span aria-hidden className="font-medium">
                        {dayLabel}
                      </span>
                      <span aria-hidden>not evaluated</span>
                    </div>
                  </li>
                );
              }

              return (
                <li key={dateKey}>
                  <CellShell
                    lighting={lowLighting(result)}
                    badge={
                      <FlagBadge
                        id={`day-list-${spot.slug}-${dateKey}`}
                        label={flagBadgeLabel(spot.name, result, week.timeZone)}
                        result={result}
                      />
                    }
                  >
                    <Link
                      href={`/spot/${spot.slug}/${dateKey}`}
                      aria-label={cellAriaLabel(spot.name, result, week.timeZone)}
                      className="cell-link flex items-baseline justify-between gap-3 rounded-md py-2 pl-3 pr-8 text-xs no-underline"
                    >
                      <span aria-hidden className="font-medium">
                        {dayLabel}
                      </span>
                      <span aria-hidden>
                        <TideLine
                          arrow="▼"
                          heightFt={result.lowFt}
                          tMs={result.lowMs}
                          timeZone={week.timeZone}
                          emphasis
                        />
                      </span>
                    </Link>
                  </CellShell>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <SpotProtection spot={spot} />

      {spot.notes ? (
        <section className="mt-5">
          <h2 className="text-xs font-semibold tracking-wide uppercase text-[var(--text-dim)]">
            From the inventory
          </h2>
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--text-dim)]">
            {spot.notes}
          </p>
        </section>
      ) : null}

      <UnresolvedDisclosure />

      <Notices notices={week.notices} />

      <div className="mt-6 border-t border-[var(--border)] pt-3">
        <EvaluationStamp
          evaluatedAtMs={week.evaluatedAtMs}
          timeZone={week.timeZone}
          extra={`spots.json ${SPOTS_VERSION} · datum ${TIDE_DATUM}`}
        />
      </div>

      <MidnightNotice
        evaluatedAtMs={week.evaluatedAtMs}
        timeZone={week.timeZone}
        evaluatedDateLabel={formatDateLong(dayStarts[0]!, week.timeZone)}
      />
    </div>
  );
}
