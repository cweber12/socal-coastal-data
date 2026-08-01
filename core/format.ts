/**
 * Number formatting shared by modules that cannot import each other.
 *
 * `lib/labels.ts` already imports from `lib/windows.ts`, so a formatter that
 * both need has to sit below both or the import cycles. That is the whole reason
 * this module exists, and it is why it imports nothing: anything added here is
 * reachable from every layer, so it must not reach back.
 */

/** U+2212 MINUS SIGN, not a hyphen: it aligns with digits and reads as a sign. */
export const MINUS = '−';

/**
 * A threshold: a value in force that a reader compares a height against.
 *
 * The intertidal floor and the calibration bin edges are both quarter-foot
 * quantities as of `shared/intertidal.json` 1.0.0 and `BIN_EDGES_FT`, and the
 * one-decimal `formatHeight` cannot render them. It printed `sunset-cliffs`'
 * 0.25 ft floor as "0.3", which is wrong in the **permissive** direction: a
 * reader comparing a 0.28 ft low against "0.3" concludes it passes, while
 * `evaluateWindow` fails it as `above-floor`. The label and the cell disagreed on
 * one screen and the label was the more generous of the two.
 *
 * A tide prediction carries more digits than anyone can act on, so rounding it
 * is a kindness. A threshold is the number the verdict is computed from, so
 * rounding it is a lie. That is the split: heights go through `formatHeight`,
 * thresholds through here.
 *
 * Exact to two decimals, which covers every quarter-foot step, with a single
 * trailing zero trimmed so a round value reads `1.0` rather than `1.00` and does
 * not claim precision it has not got. Never renders a threshold to fewer digits
 * than it carries.
 */
export function formatThreshold(ft: number): string {
  // A threshold within half a hundredth of the datum is the datum. Without this,
  // -0.001 renders "−0.0", which reads as below-datum when it is not -- the same
  // trap formatFloorGap guards at its own coarser precision.
  if (Math.abs(ft) < 0.005) return '0.0';
  // One zero only, so the result never drops below one decimal place.
  const exact = ft.toFixed(2).replace(/0$/, '');
  return exact.startsWith('-') ? MINUS + exact.slice(1) : exact;
}
