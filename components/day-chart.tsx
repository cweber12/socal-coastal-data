import { formatThreshold } from '@/lib/format';
import { formatHeight } from '@/lib/labels';
import { formatClock } from '@/lib/time';
import type { TideExtremum, TideSeries } from '@/lib/tide';
import { STATE_PRESENTATION, type WindowResult } from '@/lib/windows';
import { binFor, type SpotCalibration } from '@/lib/calibration';
import { PANEL, RateBands, RateTable } from '@/components/rate-panel';

/**
 * One local day of tide, drawn server-side as plain SVG.
 *
 * No charting library: the whole drawing is four paths, a few rules and some
 * labels, and a library would add a client bundle to render something that never
 * changes after paint. It scales by viewBox, so it stays sharp at any width
 * without measuring the viewport -- but "sharp" and "readable" are not the same
 * claim, and this comment used to make the second one. Text scales with the box
 * too, so the labels rendered at ~22px on a wide desktop and ~4px at 375px. The
 * min-width/max-width pair on the svg is what actually bounds that; see the
 * comment there.
 *
 * The SVG carries `role="img"` and a one-sentence label, and the four extrema are
 * repeated underneath as a real table. A chart is not readable by a screen reader
 * however well it is labelled, and a table of the four turning points is the same
 * information rather than a lesser substitute.
 */

const WIDTH = 760;
const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 30, left: 38 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/**
 * The plot's width, with the rate panel carved out of it when there is one.
 *
 * The viewBox does NOT grow. Its width is what the min-w-[760px] /
 * max-w-[900px] pair is calibrated against: those two numbers pin the render
 * scale between 1.0 and about 1.18, which is what keeps the 11-unit labels
 * rendering between 11px and 13px instead of the 22px-on-desktop and
 * 4px-at-375px they once did. Widening the box to make room for the panel would
 * silently move both ends of that.
 *
 * So the panel costs plot width -- 706 units down to 584, about 17% -- and a
 * spot with no published rate keeps the full 706. That is the right way round:
 * the chart is the page's subject and the panel is an addition to it.
 */
function plotWidth(hasPanel: boolean): number {
  return WIDTH - PAD.left - PAD.right - (hasPanel ? PANEL.width : 0);
}

export function DayChart({
  daySeries,
  extrema,
  window: result,
  dayStartMs,
  dayEndMs,
  sunriseMs,
  sunsetMs,
  floorFt,
  timeZone,
  nowMs,
  isToday,
  spotName,
  dateLabel,
  calibration,
  dayLowFt,
  taxaCount,
}: {
  daySeries: TideSeries;
  extrema: readonly TideExtremum[];
  window: WindowResult | null;
  dayStartMs: number;
  dayEndMs: number;
  sunriseMs: number;
  sunsetMs: number;
  floorFt: number;
  timeZone: string;
  nowMs: number;
  isToday: boolean;
  spotName: string;
  dateLabel: string;
  /**
   * This spot's calibration, or null when it was never calibrated.
   *
   * Three states, and they are not the same. `null` means absent -- the pipeline
   * never ran against this spot. `published: false` means it ran and REFUSED,
   * which is a measured verdict and gets said in words. Only `published: true`
   * draws a panel.
   */
  calibration: SpotCalibration | null;
  /** The lowest predicted height over the whole local day. The predictor. */
  dayLowFt: number | null;
  /** How many target species the rate is an OR across. */
  taxaCount: number;
}) {
  if (daySeries.samples.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border-strong)] p-4 text-meta text-[var(--text-dimmer)]">
        No prediction samples for this day, so no chart is drawn. This means unknown, not flat.
      </p>
    );
  }

  const published = calibration?.published === true ? calibration : null;
  const PLOT_W = plotWidth(published !== null);

  const heights = daySeries.samples.map((s) => s.ft);
  // The floor must always be on the chart even when the tide never reaches it --
  // that is exactly the `above-floor` case, and a floor line off-canvas would
  // leave no way to see how far off the day was.
  const rawMin = Math.min(...heights, floorFt);
  const rawMax = Math.max(...heights, floorFt);
  const span = Math.max(0.5, rawMax - rawMin);
  const yMin = rawMin - span * 0.12;
  const yMax = rawMax + span * 0.12;

  const x = (tMs: number) => PAD.left + ((tMs - dayStartMs) / (dayEndMs - dayStartMs)) * PLOT_W;
  const y = (ft: number) => PAD.top + (1 - (ft - yMin) / (yMax - yMin)) * PLOT_H;
  const clampX = (tMs: number) => Math.min(PAD.left + PLOT_W, Math.max(PAD.left, x(tMs)));

  const curve = daySeries.samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.tMs).toFixed(2)} ${y(s.ft).toFixed(2)}`)
    .join(' ');

  // Filled area under the curve, which reads as water rather than as a line graph.
  const area =
    `M${x(daySeries.samples[0]!.tMs).toFixed(2)} ${(PAD.top + PLOT_H).toFixed(2)} ` +
    daySeries.samples.map((s) => `L${x(s.tMs).toFixed(2)} ${y(s.ft).toFixed(2)}`).join(' ') +
    ` L${x(daySeries.samples[daySeries.samples.length - 1]!.tMs).toFixed(2)} ${(PAD.top + PLOT_H).toFixed(2)} Z`;

  /** Three-hourly ticks across the local day. */
  const ticks = Array.from({ length: 9 }, (_, i) => dayStartMs + ((dayEndMs - dayStartMs) * i) / 8);

  const label =
    `Tide chart for ${spotName} on ${dateLabel}. ` +
    `${extrema.length} turning points, from ${formatHeight(Math.min(...extrema.map((e) => e.ft)))} to ` +
    `${formatHeight(Math.max(...extrema.map((e) => e.ft)))} feet. ` +
    `The workable floor is ${formatThreshold(floorFt)} feet. ` +
    (result
      ? `${STATE_PRESENTATION[result.state].spoken}. ${result.reason}`
      : 'This day could not be evaluated.') +
    rateSentence(published, dayLowFt, taxaCount) +
    ' The turning points are listed in the table below this chart.' +
    (published ? ' The sighting rates are in a second table under that one.' : '');

  return (
    <figure className="m-0">
      {/*
        The chart is never scaled below 1:1, and never far above it.
        ----------------------------------------------------------------------
        Text inside a viewBox scales with the box, so a 760-unit-wide chart
        stretched to a 1780px container rendered its 9-unit labels at about
        22px -- larger than the page title -- while at 375px it squeezed the
        same labels to roughly 4px, which is not readable by anyone. It was the
        only type on the page untethered from the type scale, and it was wrong
        in both directions at once.

        min-width equal to the viewBox width pins the floor of that scale at
        exactly 1.0, so the 11-unit labels render at 11px -- the same
        --text-meta as every other caption on the page -- and below 600px the
        chart scrolls inside its container instead of shrinking into
        illegibility. max-width caps the ceiling at 900px, about 1.18, so the
        labels land near 13px and stay inside one step of the scale.
      */}
      <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full min-w-[760px] max-w-[900px] rounded-md border border-[var(--border)] bg-[var(--surface-raised)]"
      >
        {/*
          Night, before sunrise and after sunset. Set through `style` rather than
          as presentation attributes because the opacity is a custom property:
          the shade has to darken the plot in both themes, and one fixed value
          cannot do that from opposite sides of the surface.
        */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={Math.max(0, clampX(sunriseMs) - PAD.left)}
          height={PLOT_H}
          style={{ fill: 'var(--chart-night)', opacity: 'var(--chart-night-opacity)' }}
        />
        <rect
          x={clampX(sunsetMs)}
          y={PAD.top}
          width={Math.max(0, PAD.left + PLOT_W - clampX(sunsetMs))}
          height={PLOT_H}
          style={{ fill: 'var(--chart-night)', opacity: 'var(--chart-night-opacity)' }}
        />

        {/*
          The usable window. One colour, always -- it used to be tinted with the
          day's state, which made the band red on a swell veto and amber on a
          brief one. That is a lot of alarm for a verdict resting on an
          uncalibrated ceiling, and the band's job is to show WHERE the window
          falls, which is the same job whatever the verdict.
        */}
        {result && result.reachesFloor && result.usableEndMs > result.usableStartMs ? (
          <g>
            <rect
              x={clampX(result.usableStartMs)}
              y={PAD.top}
              width={Math.max(0, clampX(result.usableEndMs) - clampX(result.usableStartMs))}
              height={PLOT_H}
              fill="var(--color-window)"
              opacity="0.18"
            />
            <line
              x1={clampX(result.usableStartMs)}
              y1={PAD.top}
              x2={clampX(result.usableStartMs)}
              y2={PAD.top + PLOT_H}
              stroke="var(--color-window)"
              strokeWidth="1.5"
            />
            <line
              x1={clampX(result.usableEndMs)}
              y1={PAD.top}
              x2={clampX(result.usableEndMs)}
              y2={PAD.top + PLOT_H}
              stroke="var(--color-window)"
              strokeWidth="1.5"
            />
          </g>
        ) : null}

        {/* Height gridlines. */}
        {gridHeights(yMin, yMax).map((ft) => (
          <g key={ft}>
            <line
              x1={PAD.left}
              y1={y(ft)}
              x2={PAD.left + PLOT_W}
              y2={y(ft)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(ft) + 3.5}
              textAnchor="end"
              fontSize="11"
              fill="var(--text-dimmer)"
              fontFamily="ui-monospace, monospace"
            >
              {formatHeight(ft)}
            </text>
          </g>
        ))}

        {/* The floor. Dashed, labelled, and always on canvas. */}
        <line
          x1={PAD.left}
          y1={y(floorFt)}
          x2={PAD.left + PLOT_W}
          y2={y(floorFt)}
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <text
          x={PAD.left + PLOT_W - 3}
          y={y(floorFt) - 5}
          textAnchor="end"
          fontSize="11.5"
          fill="var(--color-accent)"
          fontWeight="600"
          paintOrder="stroke"
          stroke="var(--surface-raised)"
          strokeWidth="3.5"
          strokeLinejoin="round"
        >
          floor {formatThreshold(floorFt)} ft
        </text>

        <path d={area} fill="var(--text)" opacity="0.07" />
        <path d={curve} fill="none" stroke="var(--text)" strokeWidth="1.75" opacity="0.75" />

        {/* All four turning points, marked and labelled. */}
        {extrema.map((e) => {
          const cx = x(e.tMs);
          const cy = y(e.ft);
          const above = e.kind === 'low';
          return (
            <g key={e.tMs}>
              <circle cx={cx} cy={cy} r="3.2" fill="var(--text)" />
              {/*
                Knockout halo, not a repositioning rule.

                The 2:51 pm label was struck clean through by the red `now`
                rule, and the general case is worse than that one collision:
                these labels can also land on a gridline, on the dashed floor
                line, or on the curve itself. Nudging them away from `now`
                would fix one of four.

                paint-order="stroke" draws a fat stroke in the panel colour
                first and the fill over it, so the glyphs carry their own
                background and stay legible on top of anything the chart draws
                underneath -- without moving from the point they label.
              */}
              <text
                x={Math.min(WIDTH - PAD.right - 26, Math.max(PAD.left + 24, cx))}
                y={above ? cy + 15 : cy - 8}
                textAnchor="middle"
                fontSize="11.5"
                fill="var(--text-dim)"
                fontFamily="ui-monospace, monospace"
                paintOrder="stroke"
                stroke="var(--surface-raised)"
                strokeWidth="3.5"
                strokeLinejoin="round"
              >
                {formatHeight(e.ft)} {formatClock(e.tMs, timeZone)}
              </text>
            </g>
          );
        })}

        {/* Now, only when this is today. */}
        {isToday && nowMs >= dayStartMs && nowMs <= dayEndMs ? (
          <g>
            <line
              x1={x(nowMs)}
              y1={PAD.top - 4}
              x2={x(nowMs)}
              y2={PAD.top + PLOT_H}
              stroke="var(--color-alert)"
              strokeWidth="1.75"
            />
            <text
              x={x(nowMs)}
              y={PAD.top - 7}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="var(--color-alert)"
              paintOrder="stroke"
              stroke="var(--surface-raised)"
              strokeWidth="3.5"
              strokeLinejoin="round"
            >
              now
            </text>
          </g>
        ) : null}

        {/*
          The marginal rate panel. Last, so its marker sits over the curve rather
          than under it, and inside the same viewBox -- it is a few rects and text
          nodes, not a second chart.
        */}
        {published ? (
          <RateBands
            calibration={published}
            geometry={{
              x: PAD.left + PLOT_W,
              y,
              yMin,
              yMax,
              plotTop: PAD.top,
              plotH: PLOT_H,
            }}
            dayLowFt={dayLowFt}
          />
        ) : null}

        {/* Time axis. */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="var(--border-strong)"
          strokeWidth="1"
        />
        {ticks.map((tMs, i) => (
          <text
            key={i}
            x={x(tMs)}
            y={PAD.top + PLOT_H + 14}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
            fontSize="11"
            fill="var(--text-dimmer)"
            fontFamily="ui-monospace, monospace"
          >
            {formatClock(tMs, timeZone).replace(':00', '')}
          </text>
        ))}
      </svg>
      </div>

      <figcaption className="mt-2 max-w-prose text-meta text-[var(--text-dimmer)]">
        Shaded ends are night. The tinted band is the usable window, already trimmed on the flood
        side — a geometric claim about where the tide is under the floor, and nothing to do with
        the rates on the right. Predictions are astronomical and exclude weather-driven surge.
        {published ? (
          <>
            {' '}
            The right-hand column is the observed share of recorded visits that logged a target
            species, against the day&apos;s lowest low; the marker is this day&apos;s.
            {' '}
            Every band&apos;s number is in the table below, including the ones this day&apos;s tide
            range leaves too little room to label.
          </>
        ) : null}
      </figcaption>

      <ExtremaTable extrema={extrema} floorFt={floorFt} timeZone={timeZone} />

      {published ? (
        <RateTable
          calibration={published}
          dayLowFt={dayLowFt}
          spotName={spotName}
          taxaCount={taxaCount}
        />
      ) : null}
    </figure>
  );
}

/** The chart's content as a table, for anyone the SVG cannot serve. */
function ExtremaTable({
  extrema,
  floorFt,
  timeZone,
}: {
  extrema: readonly TideExtremum[];
  floorFt: number;
  timeZone: string;
}) {
  return (
    <table className="mt-4 w-full text-left text-data">
      <caption className="pb-1.5 text-left text-meta text-[var(--text-dim)]">
        The day&apos;s turning points
      </caption>
      <thead>
        <tr className="text-[var(--text-dimmer)]">
          <th scope="col" className="pr-3 pb-1 font-medium">Turn</th>
          <th scope="col" className="pr-3 pb-1 font-medium">Time</th>
          <th scope="col" className="pr-3 pb-1 font-medium">Height</th>
          <th scope="col" className="pb-1 font-medium">Against the floor</th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {extrema.map((e) => (
          <tr key={e.tMs} className="border-t border-[var(--border)]">
            <td className="py-1 pr-3">{e.kind === 'low' ? 'Low' : 'High'}</td>
            <td className="py-1 pr-3">{formatClock(e.tMs, timeZone)}</td>
            <td className="py-1 pr-3">{formatHeight(e.ft)} ft</td>
            <td className="py-1">
              {e.ft < floorFt
                ? `${formatHeight(e.ft - floorFt)} ft under`
                : `${(e.ft - floorFt).toFixed(1)} ft over`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The sighting rate, as a clause for the chart's spoken label.
 *
 * Named in the same sentence as the day's own low, because the claim is
 * per-day and detaching it would leave a listener with a rate and nothing to
 * attach it to. Silent when the spot has no published rate: a refused spot says
 * so in words elsewhere on the page, and repeating a refusal inside the chart's
 * label would make the chart announce something it does not draw.
 */
function rateSentence(
  published: Extract<SpotCalibration, { published: true }> | null,
  dayLowFt: number | null,
  taxaCount: number,
): string {
  if (!published || dayLowFt === null) return '';
  const bin = binFor(published, dayLowFt);
  if (!bin || bin.rate === null) {
    return (
      ` This day's lowest low is ${formatHeight(dayLowFt)} feet, which falls outside every ` +
      'band the sighting record covers, so no rate is given for it.'
    );
  }
  return (
    ` This day's lowest low is ${formatHeight(dayLowFt)} feet. Of ${bin.visits} recorded visits ` +
    `on days whose low fell between ${formatThreshold(bin.lo_ft)} and ${formatThreshold(bin.hi_ft)} ` +
    `feet, ${Math.round(bin.rate * 100)} percent logged one of ${taxaCount} target species.`
  );
}

/** Whole and half-foot gridlines, thinned out so the axis stays readable. */
function gridHeights(yMin: number, yMax: number): number[] {
  const step = yMax - yMin > 6 ? 2 : yMax - yMin > 3 ? 1 : 0.5;
  const out: number[] = [];
  for (let ft = Math.ceil(yMin / step) * step; ft <= yMax; ft += step) {
    out.push(Number(ft.toFixed(1)));
  }
  return out;
}
