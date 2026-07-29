import { binFor, USABLE_BIN_MIN_VISITS, type SpotCalibration } from '@/lib/calibration';
import { formatHeight } from '@/lib/labels';

/**
 * The observed sighting rate, as a marginal panel on the day chart's height
 * axis, and as a table beside it.
 *
 * ---------------------------------------------------------------------------
 * Why it is on the height axis and not the time axis
 * ---------------------------------------------------------------------------
 *
 * Sighting rate is a function of HEIGHT only. It varies through the day only
 * because the tide does. Encoding it along time would assert a time-dependence
 * that does not exist -- it would draw a curve that rises and falls with the
 * hours and invite a reader to conclude that four o'clock is better than noon.
 * So the bands share the y scale exactly, including the yMin/yMax padding, and
 * a band lines up with the height it describes.
 *
 * ---------------------------------------------------------------------------
 * A marker, not a sweep
 * ---------------------------------------------------------------------------
 *
 * #30 settled that the predictor is THE DAY'S LOWEST LOW, not the instantaneous
 * height. So the panel does not sweep as the day progresses. It carries one
 * marker, at this day's lowest low, against the published bin that day falls
 * in, and the claim is per-day:
 *
 *   Today's low is -1.2 ft. Of 387 recorded visits to Cabrillo on days like this
 *   one, 68% logged one of these seven species.
 *
 * `dayLowFt` is the SAMPLED minimum over the local day, not findExtrema's
 * parabolically refined turn -- measured at Cabrillo on 28 July 2026, -0.431
 * sampled against -0.4310833 refined. The refined value is the better estimate
 * of the real low and is what the chart's own extremum label shows; it is the
 * wrong one here, because the pipeline scanned raw samples and a day sitting
 * within a thousandth of a foot of a bin edge would otherwise be marked against
 * a band its counts were never computed for.
 *
 * ---------------------------------------------------------------------------
 * What this panel is not allowed to do
 * ---------------------------------------------------------------------------
 *
 * This chart's own history is the constraint. Commit 9fc56d1 and the
 * STATE_PRESENTATION comment in lib/windows.ts record why colour was stripped
 * from the grid: "the colour asserted a confidence the maths does not have".
 *
 *   Every rate is shown WITH ITS COUNT. `0.68 (387)`, never a bare percentage.
 *   The N is what makes the claim checkable and what makes a thin bin obviously
 *   thin.
 *
 *   A refused spot gets NO PANEL AT ALL, and its reason is stated in words. Five
 *   of eight refuse on the current corpus. A default or fallback band on a
 *   refused spot is exactly the null-rendering-as-a-pass failure spots.json
 *   warns against, and there is no accessor here that could produce one.
 *
 *   No statistical claim is attached to the window band. The tinted band on the
 *   main plot stays purely geometric -- where the tide is under the floor -- and
 *   this panel says nothing about it. Two honest claims that do not pretend to
 *   be each other.
 */

/**
 * Below this many visits a bin is drawn greyed rather than at full weight.
 *
 * A DISPLAY-LAYER constant. #30 established that no published number depends on
 * a display choice, and nothing in shared/calibration.json moves if this changes
 * -- the counts are the published quantity and every one of them is rendered
 * whatever this is set to.
 *
 * The value is pinned TO the pipeline's own usable-bin bar rather than chosen
 * independently, and that is the rationale rather than a coincidence: a bin the
 * refusal gates were forbidden to read is a bin a reader should not be invited
 * to read either. A looser display bar would put visual weight on exactly the
 * bins the pipeline refused to weigh, and a stricter one would hide counts that
 * the gates did use. Greyed rather than suppressed, because a thin bin is itself
 * information -- "3 visits" says something a blank row does not.
 */
export const THIN_BIN_DISPLAY_MIN_VISITS = USABLE_BIN_MIN_VISITS;

/** Layout of the panel column inside the chart's viewBox. */
export const PANEL = {
  /** Total width carved out of the plot. */
  width: 122,
  /** Gap between the plot's right edge and the first bar. */
  gutter: 10,
  /** Bar track. A rate of 1.0 fills it exactly, so bars compare across spots. */
  barWidth: 30,
  /**
   * Band height, in viewBox units, below which a band's number is not drawn.
   *
   * Sharing the height axis exactly has a cost, and this is it: on a day
   * spanning -0.4 to 6.1 ft the whole -2.5 to +1.0 stretch of bins compresses
   * into the bottom sixth of the axis, and three 10.5-unit labels land on top of
   * one another. Measured on Cabrillo, 28 July 2026.
   *
   * The band still gets drawn at the height it describes, because moving it
   * would break the one property the panel exists to have. What gives way is the
   * label, and every number it drops is in the rate table directly below --
   * which is why the caption points at that table rather than treating it as an
   * accessibility afterthought.
   *
   * 13 units is one 10.5-unit glyph plus a little air.
   */
  minLabelBandHeight: 13,
  /** Bar thickness where there is room; it shrinks to fit a thin band. */
  barHeight: 8,
} as const;

export interface RateBandGeometry {
  /** Left edge of the panel column, in viewBox units. */
  x: number;
  /** The chart's own height scale. Shared exactly, padding included. */
  y: (ft: number) => number;
  yMin: number;
  yMax: number;
  plotTop: number;
  plotH: number;
}

/**
 * The bands, as an SVG group. Rendered inside the chart's existing viewBox.
 *
 * Only bins that OVERLAP the chart's visible height range are drawn, because a
 * band has to line up with the height it describes and there is nowhere to put
 * one that describes a height off canvas. The rate table below carries every
 * bin, and the caption says how many are not shown -- a bin that is simply
 * absent from a chart and absent from the page would be a quiet omission.
 */
export function RateBands({
  calibration,
  geometry,
  dayLowFt,
}: {
  calibration: Extract<SpotCalibration, { published: true }>;
  geometry: RateBandGeometry;
  dayLowFt: number | null;
}) {
  const { x, y, yMin, yMax, plotTop, plotH } = geometry;
  const barX = x + PANEL.gutter;
  const textX = barX + PANEL.barWidth + 5;

  const dayBin = dayLowFt === null ? null : binFor(calibration, dayLowFt);

  return (
    <g>
      {/* The panel's own axis line, so the column reads as a separate scale. */}
      <line
        x1={x}
        y1={plotTop}
        x2={x}
        y2={plotTop + plotH}
        stroke="var(--border-strong)"
        strokeWidth="1"
      />
      <text
        x={barX}
        y={plotTop - 5}
        fontSize="10.5"
        fill="var(--text-dimmer)"
        fontFamily="ui-monospace, monospace"
      >
        observed rate
      </text>

      {calibration.bins.map((bin) => {
        // Clip to the visible range rather than dropping a partially visible bin:
        // the top and bottom bins nearly always run off the chart, and dropping
        // them would hide the two the amplitude ratio is computed from.
        const top = Math.min(bin.hi_ft, yMax);
        const bottom = Math.max(bin.lo_ft, yMin);
        if (top <= bottom) return null;

        const yTop = y(top);
        const yBottom = y(bottom);
        const bandH = yBottom - yTop;
        const midY = yTop + bandH / 2;
        const thin = bin.visits < THIN_BIN_DISPLAY_MIN_VISITS;
        const isDayBin = dayBin !== null && dayBin.lo_ft === bin.lo_ft;
        // The day's own band is always labelled: it is the claim being made.
        const showLabel = bandH >= PANEL.minLabelBandHeight || isDayBin;
        const barH = Math.max(2, Math.min(PANEL.barHeight, bandH - 2));

        return (
          <g key={bin.lo_ft}>
            {/* The band this day falls in, marked by its background. */}
            {isDayBin ? (
              <rect
                x={x}
                y={yTop}
                width={PANEL.width}
                height={bandH}
                fill="var(--color-accent)"
                opacity="0.12"
              />
            ) : null}

            <line
              x1={x}
              y1={yTop}
              x2={x + PANEL.width}
              y2={yTop}
              stroke="var(--border)"
              strokeWidth="1"
            />

            {bin.rate === null ? (
              // An empty bin still gets its number, but only where there is room
              // for one. It is in the table either way.
              showLabel ? (
                <text
                  x={textX}
                  y={midY + 3.5}
                  fontSize="10.5"
                  fill="var(--text-dimmer)"
                  fontFamily="ui-monospace, monospace"
                >
                  — (0)
                </text>
              ) : null
            ) : (
              <>
                {/* Track, so a short bar still reads as a short bar rather than as a missing one. */}
                <rect
                  x={barX}
                  y={midY - barH / 2}
                  width={PANEL.barWidth}
                  height={barH}
                  fill="var(--border)"
                  opacity="0.5"
                />
                <rect
                  x={barX}
                  y={midY - barH / 2}
                  // Scaled to 1.0, never to the largest bin on this spot, so a bar
                  // means the same length at every spot and on every day.
                  width={Math.max(0.75, PANEL.barWidth * bin.rate)}
                  height={barH}
                  fill={thin ? 'var(--text-dimmer)' : 'var(--color-accent)'}
                  opacity={thin ? 0.45 : 0.85}
                />
                {showLabel ? (
                  <text
                    x={textX}
                    y={midY + 3.5}
                    fontSize="10.5"
                    fill={thin ? 'var(--text-dimmer)' : 'var(--text-dim)'}
                    fontFamily="ui-monospace, monospace"
                    fontWeight={isDayBin ? 600 : undefined}
                    /*
                      The same knockout halo the extremum labels use. This day's
                      band is labelled even when it is too thin to hold a label,
                      because it carries the claim the panel is making -- so its
                      glyphs have to stay legible on top of whatever the
                      neighbouring bands drew.
                    */
                    paintOrder="stroke"
                    stroke="var(--surface-raised)"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  >
                    {/* Never a bare percentage. The N is what makes it checkable. */}
                    {bin.rate.toFixed(2)} ({bin.visits})
                  </text>
                ) : null}
              </>
            )}
          </g>
        );
      })}

      {/* The marker: this day's lowest low, on the shared height axis. */}
      {dayLowFt !== null && dayLowFt >= yMin && dayLowFt <= yMax ? (
        <g>
          <line
            x1={x - 6}
            y1={y(dayLowFt)}
            x2={x + PANEL.width}
            y2={y(dayLowFt)}
            stroke="var(--color-accent)"
            strokeWidth="1.5"
          />
          <polygon
            points={`${x - 6},${y(dayLowFt) - 4} ${x + 1},${y(dayLowFt)} ${x - 6},${y(dayLowFt) + 4}`}
            fill="var(--color-accent)"
          />
        </g>
      ) : null}
    </g>
  );
}

/**
 * The panel's content as a table.
 *
 * day-chart.tsx already sets this standard with ExtremaTable: "a chart is not
 * readable by a screen reader however well it is labelled", and a table of the
 * same numbers is the same information rather than a lesser substitute. This one
 * carries EVERY bin, including the ones that fall outside the chart's height
 * range and so have no band drawn for them.
 */
export function RateTable({
  calibration,
  dayLowFt,
  spotName,
  taxaCount,
}: {
  calibration: Extract<SpotCalibration, { published: true }>;
  dayLowFt: number | null;
  spotName: string;
  taxaCount: number;
}) {
  const dayBin = dayLowFt === null ? null : binFor(calibration, dayLowFt);

  return (
    <table className="mt-4 w-full text-left text-data">
      <caption className="pb-1.5 text-left text-meta text-[var(--text-dim)]">
        Observed sighting rate by the day&apos;s lowest low, from {calibration.visits} recorded
        visits to {spotName}
      </caption>
      <thead>
        <tr className="text-[var(--text-dimmer)]">
          <th scope="col" className="pr-3 pb-1 font-medium">
            Day&apos;s low
          </th>
          <th scope="col" className="pr-3 pb-1 font-medium">
            Visits
          </th>
          <th scope="col" className="pr-3 pb-1 font-medium">
            Logged one
          </th>
          <th scope="col" className="pb-1 font-medium">
            Rate
          </th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {calibration.bins.map((bin) => {
          const isDayBin = dayBin !== null && dayBin.lo_ft === bin.lo_ft;
          const thin = bin.visits < THIN_BIN_DISPLAY_MIN_VISITS;
          return (
            <tr
              key={bin.lo_ft}
              className={[
                'border-t border-[var(--border)]',
                thin ? 'text-[var(--text-dimmer)]' : '',
              ].join(' ')}
            >
              <td className="py-1 pr-3">
                {formatHeight(bin.lo_ft)} to {formatHeight(bin.hi_ft)} ft
                {isDayBin ? (
                  <span className="ml-2 font-sans text-meta font-medium text-[var(--color-accent)]">
                    this day
                  </span>
                ) : null}
              </td>
              <td className="py-1 pr-3">{bin.visits}</td>
              <td className="py-1 pr-3">{bin.hits}</td>
              <td className="py-1">
                {bin.rate === null ? '—' : bin.rate.toFixed(2)}
                {thin && bin.visits > 0 ? (
                  <span className="ml-2 font-sans text-meta">too few to read</span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="pt-2 font-sans text-meta text-[var(--text-dimmer)]">
            A count, not a forecast: of the visits recorded on days whose lowest low fell in each
            band, this is the share that logged one of {taxaCount} target species. It says nothing
            about whether the reef is workable — that is the floor line on the chart, and the two
            are separate claims. Bands under {THIN_BIN_DISPLAY_MIN_VISITS} visits are greyed
            because the refusal gates were not allowed to read them either.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * What a refused spot says instead of a panel.
 *
 * In words, and carrying the reason verbatim from `null_reason`. The
 * discriminated union in shared/calibration.generated.ts is what makes this the
 * only reachable branch for a refused spot -- there is no shape in which a rate
 * stands without its reason -- but the compiler cannot make the sentence read
 * like something a person wrote, so it is written here.
 */
export function RateRefusal({
  calibration,
  spotName,
}: {
  calibration: Extract<SpotCalibration, { published: false }>;
  spotName: string;
}) {
  return (
    <section
      aria-labelledby="rate-refusal-heading"
      className="mt-4 rounded-md border border-dashed border-[var(--border-strong)] p-3"
    >
      <h3
        id="rate-refusal-heading"
        className="text-ui font-semibold tracking-wide uppercase text-[var(--text-dim)]"
      >
        No sighting rate for {spotName}
      </h3>
      <p className="mt-1.5 max-w-prose text-ui text-[var(--text-dim)]">
        The calibration ran against {calibration.visits} recorded visits here and declined to
        publish a rate. That is a refusal, not a zero: it means the record cannot support the
        claim, never that nothing is out there.
      </p>
      <p className="mt-1.5 max-w-prose text-meta text-[var(--text-dimmer)]">
        {calibration.null_reason}
      </p>
    </section>
  );
}
