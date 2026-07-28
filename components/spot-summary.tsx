import Link from 'next/link';

import { thresholdDisclosure } from '@/lib/labels';
import type { SwellCeiling } from '@/lib/thresholds';
import type { SpotSwell } from '@/lib/upstream';
import type { TidepoolSpot } from '@/shared/spots.generated';

/**
 * The parts of a spot that are not a tide reading: where it is, what it is
 * being judged against, and where its swell number came from.
 *
 * Split out of week-ribbon.tsx because two different callers want different
 * subsets of it. The spot page wants all of this AND the seven-day strip. The
 * grid's row disclosure wants only this -- see SpotDisclosure below for why.
 */

/** Coordinates and the two uncalibrated numbers this spot is judged against. */
export function SpotHeader({
  spot,
  ceiling,
  showSpotLink,
  /**
   * True when the host page already carries the spot's name as its `h1`.
   *
   * The spot page did: an `h1` reading "Cabrillo Tidepools" with an `h3`
   * repeating it verbatim in the panel directly beneath. The coordinates and
   * the thresholds still belong here; the name is the only part that was
   * already on the page. The grid's row disclosure passes false, because there
   * this heading is the panel's only label.
   */
  nameOnPage = false,
}: {
  spot: TidepoolSpot;
  ceiling: SwellCeiling;
  showSpotLink: boolean;
  nameOnPage?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      {/*
        The heading goes away with the name, rather than staying and holding
        the coordinates.

        The first version of nameOnPage swapped the h3's CONTENTS and left the
        element, which produced `<h3>32.669, -117.245</h3>`. A heading whose
        text is a coordinate pair is not a heading: it breaks the document
        outline for anyone navigating by headings, and it does not name the
        panel it sits in either. When the host page already carries the spot as
        its h1, there is no second heading to write here -- the coordinates are
        a caption.
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
          spot.tidepool_floor_ft,
          spot.tidepool_floor_confidence,
          ceiling.ceilingFt,
          ceiling.confidence,
        )}
      </p>
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
    <p className="mt-2 text-meta text-[var(--text-dimmer)]">
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

/**
 * What a grid row discloses when it is expanded.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the week ribbon any more
 * ---------------------------------------------------------------------------
 *
 * It used to be. The grid built a full WeekRibbon for all eight rows and handed
 * it to SpotRow, which is a client component -- and a prop given to a client
 * component is serialised into the flight payload whether or not the row is
 * open. Measured on the rendered page: a 530,528-byte document carrying a
 * 345,152-byte RSC stream, of which 163,926 bytes -- 47% -- were rows belonging
 * to ribbons nobody had opened.
 *
 * The fix is not lazy loading. It is that the strip was REDUNDANT at the only
 * width where it could be seen. The disclosure row is `hidden wide:table-row`,
 * so it exists at >= 600px, and at >= 600px the grid row above it already shows
 * all seven days -- the other six columns are `hidden ... wide:table-cell`.
 * Expanding a row printed the same seven lows and highs a second time, one row
 * lower, in a different shape.
 *
 * What the row genuinely cannot show, because there is nowhere in a table cell
 * to put it, is this: where the spot is, which floor and ceiling the verdicts
 * are being decided against, and which buoy the swell actually came from. So
 * that is what the disclosure is now.
 *
 * /spot/[slug] keeps the full WeekRibbon. There the strip IS the week view and
 * there is nothing above it repeating those cells.
 */
export function SpotDisclosure({
  spot,
  swell,
  ceiling,
}: {
  spot: TidepoolSpot;
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
