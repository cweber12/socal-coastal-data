import { SPOTS_VERSION, TIDEPOOL_SPOTS, SPOTS_WITHOUT_FLOOR } from '@/shared/spots.generated';

/**
 * Scaffold placeholder. The spot x day grid lands in issue #7; this page exists
 * so the scaffold commit builds and so the derived grid scope is visible from
 * the first commit rather than being asserted in a PRD and checked later.
 */
export default function Home() {
  return (
    <div className="max-w-prose space-y-4 text-sm leading-relaxed">
      <h1 className="text-lg font-semibold tracking-tight">Scaffold in place</h1>
      <p className="text-[var(--text-dim)]">
        Inventory version {SPOTS_VERSION}. {TIDEPOOL_SPOTS.length} of{' '}
        {TIDEPOOL_SPOTS.length + SPOTS_WITHOUT_FLOOR.length} spots carry a
        tidepool floor and are in scope for the window grid.
      </p>
      <ul className="space-y-1 font-mono text-xs text-[var(--text-dim)]">
        {TIDEPOOL_SPOTS.map((spot) => (
          <li key={spot.slug}>
            {spot.name} — floor {spot.tidepool_floor_ft.toFixed(1)} ft (
            {spot.tidepool_floor_confidence})
          </li>
        ))}
      </ul>
    </div>
  );
}
