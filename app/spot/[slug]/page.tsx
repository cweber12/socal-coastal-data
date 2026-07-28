import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { EvaluationStamp, Notices, UpstreamFailure } from '@/components/disclosure';
import { MidnightNotice } from '@/components/midnight-notice';
import { WeekRibbon } from '@/components/week-ribbon';
import { SpotProtection } from '@/components/spot-protection';
import { loadSpotWeek, tidepoolSpotBySlug } from '@/lib/grid';
import { formatDateLong, startOfLocalDay } from '@/lib/time';
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

          {/* Below 600px, the week becomes a vertical list of days. */}
          <ol className="list-none space-y-1.5 wide:hidden">
            {week.dates.map((date, i) => {
              const result = week.days[i];
              return (
                <li key={`${date.year}-${date.month}-${date.day}`}>
                  <Link
                    href={`/spot/${spot.slug}/${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs no-underline"
                  >
                    <span className="font-medium">
                      {formatDateLong(dayStarts[i]!, week.timeZone)}
                    </span>
                    <span className="text-[var(--text-dim)]">
                      {result ? result.reason : 'not evaluated'}
                    </span>
                  </Link>
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
