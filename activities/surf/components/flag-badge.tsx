import type { SurfDay } from '@/activities/surf/policy';
import { STATE_PRESENTATION } from '@/activities/surf/states';

/**
 * The day's state, behind a badge.
 *
 * A copy of activities/tidepool/components/flag-badge.tsx, and the argument it
 * makes is stronger here rather than merely repeated. Tidepool's badge exists
 * because its two deciding numbers are uncalibrated; every number deciding a
 * surf verdict is uncalibrated AND the surf zone has no measured fact behind any
 * of them -- no floor, no ledger, no instrument path. So the verdict is
 * disclosed on request and closed by default, and the tide and the clock in the
 * cell are what a reader is meant to act on.
 *
 * A native popover for the same reason: the grid scrolls sideways inside an
 * `overflow-x` container, and a panel positioned inside a cell would be clipped
 * at the container edge -- worst in the last column, which is exactly where a
 * right-hand badge sits. The `popover` attribute puts the panel in the top
 * layer, outside every ancestor's overflow and stacking context, and brings
 * light dismiss, Escape and focus return with it.
 *
 * The badge is a SIBLING of the cell's link, never a child.
 */
export function FlagBadge({
  id,
  label,
  day,
  className,
}: {
  /**
   * Unique per badge and stable across renders, since it becomes both an element
   * id and a CSS anchor name. Callers build it from data that is already unique
   * -- spot slug and date -- rather than from a hook, so this stays a server
   * component. Must be [a-z0-9-]: it is used as a dashed-ident.
   */
  id: string;
  /** Spoken name for the button. The cell's own aria-label carries the verdict. */
  label: string;
  day: SurfDay;
  className?: string;
}) {
  const popoverId = `flag-${id}`;
  const anchorName = `--flag-${id}`;
  const presentation = STATE_PRESENTATION[day.state];

  return (
    <>
      <button
        type="button"
        popoverTarget={popoverId}
        aria-label={label}
        className={['flag-badge', className].filter(Boolean).join(' ')}
        style={{ ['--flag-anchor' as string]: anchorName }}
      >
        {/* One glyph for every state. A badge that varied by state would put the
            verdict back on the face of the grid. */}
        <span aria-hidden>i</span>
      </button>

      <div
        id={popoverId}
        popover="auto"
        className="flag-popover"
        style={{ ['--flag-anchor' as string]: anchorName }}
      >
        <p className="flex items-center gap-1.5 text-ui font-semibold">
          <span aria-hidden className="text-[var(--text-dim)]">
            {presentation.glyph}
          </span>
          {presentation.label}
        </p>

        <p className="mt-1 text-ui">{day.reason}</p>

        <p className="mt-2 border-t border-[var(--border)] pt-2 text-meta text-[var(--text-dimmer)]">
          Provisional. The tide band ({day.band.minFt.toFixed(1)}–{day.band.maxFt.toFixed(1)} ft),
          the swell ceiling ({day.swellCeilingFt.toFixed(1)} ft) and the swell minimum (
          {day.swellMinimumFt.toFixed(1)} ft) this is decided against are all author estimates,
          none has been field-checked, and the surf zone holds no measured fact behind them. Buoy
          wave height is not breaking height at the break. Read the tide and the clock above as
          the primary evidence.
        </p>
      </div>
    </>
  );
}
