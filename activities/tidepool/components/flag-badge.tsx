import type { WindowResult } from '@/activities/tidepool/policy';
import { STATE_PRESENTATION } from '@/activities/tidepool/states';

/**
 * The window state, behind a badge.
 *
 * ---------------------------------------------------------------------------
 * Why the state is not on the cell any more
 * ---------------------------------------------------------------------------
 *
 * Every state this thing can report is decided against two numbers that have
 * never been field-checked: a per-spot floor that is an author estimate, and a
 * swell ceiling that is a corridor-wide default. On top of that there is no
 * swell forecast in the stack at all -- a live buoy reading stands in for up to
 * five days and then gives up. A verdict from that machinery is worth showing,
 * but it is not worth painting across a grid in red and amber, which reads as a
 * measurement. It is secondary until the thresholds are real, so it is disclosed
 * on request and closed by default.
 *
 * ---------------------------------------------------------------------------
 * Why a native popover
 * ---------------------------------------------------------------------------
 *
 * The grid scrolls sideways inside an `overflow-x` container. A panel positioned
 * inside a cell would be clipped at the container edge -- worst in the last
 * column, which is exactly where a right-hand badge sits. The `popover`
 * attribute puts the panel in the top layer, outside every ancestor's overflow
 * and stacking context, and brings light dismiss, Escape and focus return with
 * it. No state, no effect, no client component: this renders on the server like
 * the rest of the grid.
 *
 * The badge is a SIBLING of the cell's link, never a child. A button inside an
 * anchor is announced as one control and behaves as two.
 */
export function FlagBadge({
  id,
  label,
  result,
  className,
}: {
  /**
   * Unique per badge and stable across renders, since it becomes both an element
   * id and a CSS anchor name. Callers build it from data that is already unique
   * -- spot slug and date -- rather than from a hook, so this stays a server
   * component. Must be [a-z0-9-]: it is used as a dashed-ident.
   */
  id: string;
  /** Spoken name for the button. The cell's own aria-label already carries the verdict. */
  label: string;
  result: WindowResult;
  className?: string;
}) {
  const popoverId = `flag-${id}`;
  const anchorName = `--flag-${id}`;
  const presentation = STATE_PRESENTATION[result.state];

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

        <p className="mt-1 text-ui">{result.reason}</p>

        <p className="mt-2 border-t border-[var(--border)] pt-2 text-meta text-[var(--text-dimmer)]">
          Provisional. The floor ({result.detail.floorFt.toFixed(1)} ft) and swell ceiling (
          {result.swellCeilingFt.toFixed(1)} ft) this is decided against are author estimates and
          have not been field-checked. Read the tide and the clock above it as the primary
          evidence.
        </p>
      </div>
    </>
  );
}
