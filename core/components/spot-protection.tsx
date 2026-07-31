import type { Spot } from '@/shared/spots.generated';

/**
 * The spot's marine protected area status, stated as a disclosure and never as a
 * permission.
 *
 * spots.json calls this field "legally load-bearing for the tidepool audience",
 * and every spot in this grid IS a tidepool spot, so a tool that computes when to
 * walk out onto a reef and says nothing about whether collecting there is legal
 * has left out the one field its own inventory flags as legally significant.
 *
 * The rule this component exists to enforce is the file's own: a null `mpa` with
 * `mpa_resolved: false` means UNKNOWN, not unprotected. Five of the eight spots
 * here are in that state -- they sit within 150 m of a boundary, inside the file's
 * ~100 m coordinate precision, so the in/out call is untrustworthy in both
 * directions. Cabrillo is the sharpest case: point-in-polygon puts it INSIDE
 * Cabrillo SMR, where no take of any kind is allowed, but by 11 m. The thin margin
 * is a reason to verify the boundary, never to relax the restriction.
 *
 * So: unresolved always renders as "treat as restricted", never as "probably
 * fine", whichever side of the line the join happened to land on.
 */
export function SpotProtection({ spot }: { spot: Spot }) {
  const restricted = !spot.mpa_resolved || spot.mpa !== null;

  return (
    <section
      className="tint-panel mt-5 rounded-md border p-3"
      style={{
        ['--tint-color' as string]: restricted ? 'var(--color-caution)' : 'var(--border-strong)',
      }}
    >
      <h2 className="text-ui font-semibold tracking-wide uppercase">Marine protection</h2>

      {!spot.mpa_resolved ? (
        <p className="mt-1.5 text-ui">
          <strong>Unresolved — treat as restricted.</strong> This spot lies within 150 m of a
          marine protected area boundary, which is inside the ±100 m precision of its own
          coordinate. The point-in-polygon join {spot.mpa ? `returned ${spot.mpa}` : 'returned no area'},
          but at that margin the result cannot be trusted in either direction.{' '}
          {spot.mpa === null
            ? 'A null here means unknown, not unprotected.'
            : 'Do not read the named area as the final answer either.'}{' '}
          Check the CDFW regulations for this location before taking anything.
        </p>
      ) : spot.mpa !== null ? (
        <p className="mt-1.5 text-ui">
          <strong>Inside {spot.mpa}.</strong> Resolved by point-in-polygon against CDFW ds582 and
          outside the coordinate error bar. A state marine reserve prohibits take of any kind.
          Confirm the current regulations for this area before collecting.
        </p>
      ) : (
        <p className="mt-1.5 text-ui">
          Outside every CDFW marine protected area polygon, resolved and outside the coordinate
          error bar. That is a statement about MPA boundaries only — other closures, seasonal
          restrictions and take limits are not in this dataset.
        </p>
      )}

      <p className="tint-panel-source mt-2 text-meta">
        Seasonal closures — pinniped haul-outs at La Jolla, Least Tern nesting — are in no API
        this stack reads and are not reflected here.
      </p>
    </section>
  );
}
