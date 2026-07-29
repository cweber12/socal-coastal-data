import { sightingsSummaryLine, describeSighting, formatSightingTide } from '@/lib/labels';
import type { SpotSightingsGallery, SpotSightingsSummary } from '@/lib/grid';
import { formatClock, formatDayMonth } from '@/lib/time';
import type { AnnotatedSighting } from '@/lib/sightings';

/**
 * What people have actually seen here lately, and at what tide.
 *
 * ---------------------------------------------------------------------------
 * Why the gallery is on the spot page and not in the grid's row disclosure
 * ---------------------------------------------------------------------------
 *
 * Two constraints, both already recorded in components/spot-row.tsx.
 *
 * A prop handed to a client component is serialised into the RSC flight payload
 * whether or not it is ever displayed, so `detail` ships on every request,
 * opened or not. That is what made a seven-day ribbon 47% of the payload in
 * PR #18. Eight photo galleries would re-commit exactly that.
 *
 * And below 600px the disclosure toggle is replaced by a plain link -- the
 * dropdown does not exist on phones at all. A sightings display living only
 * there is a feature phone readers never see.
 *
 * So the dropdown gets one line of text and /spot/[slug] gets the gallery. The
 * spot page is server-rendered and is where phone readers land.
 *
 * ---------------------------------------------------------------------------
 * Empty is not unavailable
 * ---------------------------------------------------------------------------
 *
 * "No research-grade sightings recorded here in the last 14 days" is a fact
 * about the record. "Could not reach iNaturalist" is a fact about the
 * connection. They render differently because they are different, and a 200
 * carrying an empty array is only ever the first.
 */

/** The one line a grid row discloses. A few hundred bytes, deliberately. */
export function SightingsSummary({
  sightings,
  nowMs,
}: {
  sightings: SpotSightingsSummary;
  nowMs: number;
}) {
  return (
    <p className="mt-2 text-ui text-[var(--text-dim)]">
      {sightings.kind === 'unavailable' ? (
        <>
          <strong>Recent sightings unavailable.</strong> iNaturalist did not answer, which is a
          failed request rather than an empty reef.
        </>
      ) : (
        sightingsSummaryLine(sightings, nowMs)
      )}
    </p>
  );
}

/**
 * The gallery.
 *
 * Server-rendered SVG-free markup with no client component anywhere in it, so
 * it adds nothing to the bundle -- the same standard components/day-chart.tsx
 * holds.
 */
export function SightingsSection({
  gallery,
  spotName,
  timeZone,
}: {
  gallery: SpotSightingsGallery;
  spotName: string;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="sightings-heading" className="mt-6">
      <h2
        id="sightings-heading"
        className="text-ui font-semibold tracking-wide uppercase text-[var(--text-dim)]"
      >
        Recently seen here
      </h2>

      {gallery.kind === 'unavailable' ? (
        <div
          className="tint-panel mt-2 rounded-md border p-3"
          style={{ ['--tint-color' as string]: 'var(--color-alert)' }}
        >
          <p className="text-ui font-semibold">Sightings could not be loaded.</p>
          <p className="mt-1 text-ui">
            That is a failed request, not an empty reef — nothing here says anything about what is
            or is not out at {spotName}. The tide content above is unaffected.
          </p>
          <p className="mt-1.5 font-mono text-meta break-all text-[var(--text-dim)]">
            {gallery.reason}
          </p>
        </div>
      ) : gallery.shown.length === 0 ? (
        <EmptySightings gallery={gallery} spotName={spotName} />
      ) : (
        <>
          <SightingsProvenance gallery={gallery} />
          {/*
            One column on a phone, two from 600px, three from 1024px.

            600px is `wide:`, this file's own breakpoint, and NOT Tailwind's
            `sm` -- globals.css opens with why those 40px matter here. 1024 is
            `lg`, which is a plain default and carries no such trap: nothing
            about the grid collapse happens near it.
          */}
          <ul className="mt-2 grid list-none gap-2.5 wide:grid-cols-2 lg:grid-cols-3">
            {gallery.shown.map((sighting) => (
              <li key={sighting.id}>
                <SightingCard sighting={sighting} timeZone={timeZone} />
              </li>
            ))}
          </ul>
          <SightingsFootnote gallery={gallery} />
        </>
      )}
    </section>
  );
}

/**
 * Nothing recorded, said as a fact about the record rather than about the reef.
 *
 * The distinction matters here specifically: a research-grade filter means an
 * observation must be uploaded AND community-confirmed, so a quiet fortnight at
 * a thinly-observed spot says more about who carries a phone there than about
 * what lives there.
 */
function EmptySightings({
  gallery,
  spotName,
}: {
  gallery: Extract<SpotSightingsGallery, { kind: 'ok' }>;
  spotName: string;
}) {
  const placedNone = gallery.totalResults > 0;
  return (
    <div className="mt-2 rounded-md border border-dashed border-[var(--border-strong)] p-3">
      <p className="text-ui text-[var(--text-dim)]">
        {placedNone ? (
          <>
            iNaturalist counted {gallery.totalResults} research-grade{' '}
            {gallery.totalResults === 1 ? 'observation' : 'observations'} near {spotName} in the
            last {gallery.windowDays} days, but none on the page fetched could be placed at the
            spot.
          </>
        ) : (
          <>
            No research-grade sightings recorded within 500 m of {spotName} in the last{' '}
            {gallery.windowDays} days.
          </>
        )}
      </p>
      <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
        That is a statement about the record, not about the reef. Research grade means an
        observation was confirmed by other identifiers, so a quiet fortnight at a
        thinly-observed spot reflects who was there with a camera.
      </p>
    </div>
  );
}

function SightingsProvenance({
  gallery,
}: {
  gallery: Extract<SpotSightingsGallery, { kind: 'ok' }>;
}) {
  return (
    <p className="mt-1.5 max-w-prose text-ui text-[var(--text-dim)]">
      The newest {gallery.shown.length} of {gallery.totalResults} research-grade{' '}
      {gallery.totalResults === 1 ? 'observation' : 'observations'} recorded within 500 m in the
      last {gallery.windowDays} days, from{' '}
      <a href="https://www.inaturalist.org/" rel="noopener noreferrer">
        iNaturalist
      </a>
      . Each carries the predicted tide at the moment it was recorded, from the same station the
      chart above reads.
    </p>
  );
}

/**
 * The licence and exclusion footnote.
 *
 * Both halves are disclosures rather than decoration. Photos appear only under
 * a CC licence, and the records whose photos cannot be shown are still LISTED --
 * dropping them would quietly select the feed toward observers who happen to
 * license permissively, and then this section's claim about what people are
 * seeing would be a claim about what people are licensing.
 */
function SightingsFootnote({
  gallery,
}: {
  gallery: Extract<SpotSightingsGallery, { kind: 'ok' }>;
}) {
  const withheld = gallery.shown.filter((s) => s.photo === null).length;
  const { obscured, captive, outsideRadius, notResearchGrade, noLocation } = gallery.excluded;
  const dropped = obscured + captive + outsideRadius + notResearchGrade + noLocation;

  return (
    <p className="mt-2 max-w-prose text-meta text-[var(--text-dimmer)]">
      Photos are shown only where the photographer licensed them for reuse.{' '}
      {withheld > 0
        ? `${withheld} of these ${gallery.shown.length} ${withheld === 1 ? 'is' : 'are'} listed without one; the observation is still here, because dropping it would bias the list toward observers who license permissively. `
        : ''}
      {dropped > 0
        ? `${dropped} of the ${gallery.fetchedCount} records fetched were excluded before this list: ${[
            obscured > 0 ? `${obscured} with an obscured location` : null,
            outsideRadius > 0 ? `${outsideRadius} beyond 500 m` : null,
            captive > 0 ? `${captive} captive` : null,
            notResearchGrade > 0 ? `${notResearchGrade} not research grade` : null,
            noLocation > 0 ? `${noLocation} with no location` : null,
          ]
            .filter(Boolean)
            .join(', ')}. `
        : ''}
      Conservation-obscured taxa are never shown: iNaturalist randomises their coordinates, so
      such a record cannot be placed at a reef even in principle.
    </p>
  );
}

/**
 * One sighting.
 *
 * The whole card is a link to the observation, so the photo, the name and the
 * credit are one tab stop rather than three pointing at the same place.
 *
 * The image carries `alt=""` deliberately. Everything the photograph conveys as
 * INFORMATION -- what was seen, by whom, when, at what tide -- is in the text
 * beside it, and a duplicate alt would make a screen reader announce the
 * species twice per card. The link itself carries the full sentence, so a
 * listener tabbing through gets one complete reading of each sighting and no
 * repetition. That is the same reasoning flagBadgeLabel already applies to the
 * grid's badges.
 */
function SightingCard({
  sighting,
  timeZone,
}: {
  sighting: AnnotatedSighting;
  timeZone: string;
}) {
  const when =
    sighting.observedAtMs !== null
      ? `${formatDayMonth(sighting.observedAtMs, timeZone)}, ${formatClock(sighting.observedAtMs, timeZone)}`
      : `${sighting.observedOn.day}/${sighting.observedOn.month} · time not recorded`;

  return (
    <a
      href={sighting.uri}
      rel="noopener noreferrer"
      aria-label={describeSighting(sighting, timeZone)}
      /*
        Not `.cell-link`. That rule mixes its hover from `--cell-fg`, which only
        exists inside a grid cell's lighting context; out here it would resolve
        to an invalid color-mix and the hover would silently do nothing.
      */
      className="block h-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-raised)] no-underline hover:border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]"
    >
      {sighting.photo ? (
        /*
          A fixed 4:3 box with object-cover, rather than the photo's own
          dimensions. iNaturalist does not serve dimensions in the field set this
          app asks for, and a box that cannot change size cannot shift the layout
          when the image arrives.
        */
        <img
          src={sighting.photo.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full bg-[var(--surface-sunken)] object-cover"
        />
      ) : (
        /*
          A strip, not a 4:3 placeholder.

          The first version reserved the photo's own box and filled it with the
          reason, which at 375px gave a text entry the visual weight of a
          photograph and left a phone screen mostly empty boxes -- Windansea's
          four records are two photos and two of these. The entry is text, so it
          takes the room text takes, and the ragged card height is the honest
          shape of a list where some records carry a photo and some do not.
        */
        <div
          aria-hidden
          className="border-b border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-meta text-[var(--text-dimmer)]"
        >
          No photo — {sighting.photoWithheldReason}
        </div>
      )}

      <div aria-hidden className="p-2.5">
        <p className="text-data font-medium leading-tight">
          {sighting.commonName ?? sighting.scientificName}
        </p>
        <p className="text-meta italic text-[var(--text-dim)]">{sighting.scientificName}</p>

        {/*
          The tide line. This is what makes the section ours rather than an
          iNaturalist embed, and it is the one fact on the card a reader could
          not have got from the photo.
        */}
        <p className="mt-1.5 font-mono text-meta text-[var(--text)]">
          {sighting.tide ? (
            formatSightingTide(sighting.tide)
          ) : (
            <span className="text-[var(--text-dimmer)]">
              no tide height — {sighting.tideUnavailableReason}
            </span>
          )}
        </p>

        <p className="mt-1 text-meta text-[var(--text-dimmer)]">{when}</p>
        <p className="truncate text-meta text-[var(--text-dimmer)]">
          {sighting.photo
            ? sighting.photo.attribution
            : `© ${sighting.observerName ?? sighting.observerLogin}`}
        </p>
      </div>
    </a>
  );
}
