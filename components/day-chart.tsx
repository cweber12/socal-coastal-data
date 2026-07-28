import { formatHeight } from '@/lib/labels';
import { formatClock } from '@/lib/time';
import type { TideExtremum, TideSeries } from '@/lib/tide';
import { STATE_PRESENTATION, type WindowResult } from '@/lib/windows';

/**
 * One local day of tide, drawn server-side as plain SVG.
 *
 * No charting library: the whole drawing is four paths, a few rules and some
 * labels, and a library would add a client bundle to render something that never
 * changes after paint. It scales by viewBox, so it stays sharp and readable at any
 * width without measuring the viewport.
 *
 * The SVG carries `role="img"` and a one-sentence label, and the four extrema are
 * repeated underneath as a real table. A chart is not readable by a screen reader
 * however well it is labelled, and a table of the four turning points is the same
 * information rather than a lesser substitute.
 */

const WIDTH = 760;
const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 30, left: 38 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

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
}) {
  if (daySeries.samples.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border-strong)] p-4 text-xs text-[var(--text-dimmer)]">
        No prediction samples for this day, so no chart is drawn. This means unknown, not flat.
      </p>
    );
  }

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
    `The workable floor is ${formatHeight(floorFt)} feet. ` +
    (result
      ? `${STATE_PRESENTATION[result.state].spoken}. ${result.reason}`
      : 'This day could not be evaluated.') +
    ' The turning points are listed in the table below this chart.';

  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)]"
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
              fontSize="9"
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
          fontSize="9.5"
          fill="var(--color-accent)"
          fontWeight="600"
        >
          floor {formatHeight(floorFt)} ft
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
              <text
                x={Math.min(WIDTH - PAD.right - 26, Math.max(PAD.left + 24, cx))}
                y={above ? cy + 15 : cy - 8}
                textAnchor="middle"
                fontSize="9.5"
                fill="var(--text-dim)"
                fontFamily="ui-monospace, monospace"
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
              fontSize="9"
              fontWeight="600"
              fill="var(--color-alert)"
            >
              now
            </text>
          </g>
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
            fontSize="9"
            fill="var(--text-dimmer)"
            fontFamily="ui-monospace, monospace"
          >
            {formatClock(tMs, timeZone).replace(':00', '')}
          </text>
        ))}
      </svg>

      <figcaption className="mt-2 text-xs text-[var(--text-dimmer)]">
        Shaded ends are night. The tinted band is the usable window, already trimmed on the flood
        side. Predictions are astronomical and exclude weather-driven surge.
      </figcaption>

      <ExtremaTable extrema={extrema} floorFt={floorFt} timeZone={timeZone} />
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
    <table className="mt-4 w-full text-left text-xs">
      <caption className="pb-1.5 text-left text-xs text-[var(--text-dim)]">
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

/** Whole and half-foot gridlines, thinned out so the axis stays readable. */
function gridHeights(yMin: number, yMax: number): number[] {
  const step = yMax - yMin > 6 ? 2 : yMax - yMin > 3 ? 1 : 0.5;
  const out: number[] = [];
  for (let ft = Math.ceil(yMin / step) * step; ft <= yMax; ft += step) {
    out.push(Number(ft.toFixed(1)));
  }
  return out;
}
