import Link from 'next/link';

import { thresholdDisclosure } from '@/activities/surf/labels';
import { SURF_SWELL_MINIMUM, SURF_TIDE_BAND } from '@/activities/surf/thresholds';
import type { SwellCeiling } from '@/core/thresholds';
import type { SpotSwell } from '@/core/upstream';
import type { SurfSpot } from '@/core/zones/surf';

/**
 * The parts of a spot that are not a tide reading: where it is, what it is being
 * judged against, and where its swell number came from.
 *
 * A copy of activities/tidepool/components/spot-summary.tsx with the sightings
 * summary removed -- there is no iNaturalist equivalent for a surf zone -- and
 * with the swell paragraph carrying a second threshold, because surf reads the
 * buoy in both directions.
 */

/** Coordinates and the three uncalibrated numbers this spot is judged against. */
export function SpotHeader({
  spot,
  ceiling,
  showSpotLink,
  nameOnPage = false,
}: {
  spot: SurfSpot;
  ceiling: SwellCeiling;
  showSpotLink: boolean;
  /** True when the host page already carries the spot's name as its `h1`. */
  nameOnPage?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      {/*
        The heading goes away with the name rather than staying and holding the
        coordinates. A heading whose text is a coordinate pair is not a heading:
        it breaks the document outline for anyone navigating by headings, and it
        does not name the panel it sits in either.
      */}
      {nameOnPage ? (
        <p className="text-meta text-[var(--text-dimmer)]">
          {spot.lat.toFixed(3)}, {spot.lon.toFixed(3)}
        </p>
      ) : (
        <h3 className="text-section font-semibold tracking-tight">
          {showSpotLink ? <Link href={`/spot/${spot.slug}`}>{spot.name}</Link> : spot.name}
          <span className="ml-2 text-meta font-normal text-[var(--text-dimmer)]">
            {spot.lat.toFixed(3)}, {spot.lon.toFixed(3)}
          </span>
        </h3>
      )}
      <p className="text-meta text-[var(--text-dimmer)]">
        {thresholdDisclosure(
          SURF_TIDE_BAND,
          SURF_TIDE_BAND.confidence,
          ceiling.ceilingFt,
          ceiling.confidence,
          SURF_SWELL_MINIMUM.ft,
          SURF_SWELL_MINIMUM.confidence,
        )}
      </p>
    </div>
  );
}

/**
 * Where the swell number came from, and both limits it is read against.
 *
 * spots.json's schema requires the UI to disclose a fallback substitution, since
 * a fallback "may be geographically distant". A null reading says unknown, never
 * calm and never flat.
 *
 * The sentence about breaking height is not optional decoration. It is the
 * caveat ADR 0008 calls the one a reader of this page is most likely to act on,
 * it sits in core/zones/surf.ts's unresolved array as well, and it is repeated
 * here because this is the paragraph where the buoy number is actually shown.
 */
export function SwellProvenance({
  swell,
  ceiling,
}: {
  swell: SpotSwell;
  ceiling: SwellCeiling;
}) {
  return (
    <p className="mt-2 text-ui text-[var(--text-dim)]">
      {swell.swellFt === null ? (
        <>
          <strong>Swell unknown.</strong> No buoy in this spot&apos;s binding is delivering a wave
          height, so no day can read as a pass. Unknown is not flat.
        </>
      ) : (
        <>
          Swell {swell.swellFt.toFixed(1)} ft from {swell.sourceBuoyId} ({swell.sourceBuoyName})
          {swell.ageMinutes !== null ? `, ${Math.round(swell.ageMinutes)} min old` : ''}
          {swell.substituted ? (
            <>
              . <strong>Substituted:</strong> this spot&apos;s primary buoy is not delivering, so a
              fallback is standing in. It may be geographically distant and read differently for
              the same conditions
            </>
          ) : null}
          {swell.intendedBuoyId && swell.intendedBuoyId !== swell.sourceBuoyId ? (
            <>
              . The buoy that should serve this spot is {swell.intendedBuoyId}, which is marked
              dead
            </>
          ) : null}
          . Read against an {ceiling.confidence} window of{' '}
          {SURF_SWELL_MINIMUM.ft.toFixed(1)}–{ceiling.ceilingFt.toFixed(1)} ft
          {ceiling.isDefault ? ' (corridor default ceiling, no per-spot calibration)' : ''}.{' '}
          <strong>This is the buoy&apos;s significant wave height, not the height of the wave at
          the break.</strong>{' '}
          No shoaling or refraction transform is applied anywhere in this stack.
        </>
      )}
    </p>
  );
}

/**
 * What a grid row discloses when it is expanded.
 *
 * Deliberately not a week strip. The lesson tidepool's equivalent records
 * applies unchanged and costs more here: `detail` is a prop on a client
 * component, so it is serialised into the flight payload for every row on every
 * request whether or not anybody expands one -- and this grid has 24 rows to
 * tidepool's 8.
 *
 * What a table cell has nowhere to put is where the spot is, which band and
 * limits its verdicts are decided against, and which buoy the swell came from.
 * That is what this is.
 */
export function SpotDisclosure({
  spot,
  swell,
  ceiling,
}: {
  spot: SurfSpot;
  swell: SpotSwell;
  ceiling: SwellCeiling;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <SpotHeader spot={spot} ceiling={ceiling} showSpotLink />
      <SwellProvenance swell={swell} ceiling={ceiling} />
    </div>
  );
}
