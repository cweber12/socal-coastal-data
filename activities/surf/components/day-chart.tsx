import { formatThreshold } from '@/core/format';
import { formatHeight, sessionAnchorLabel } from '@/activities/surf/labels';
import { formatClock, formatDuration } from '@/core/time';
import type { TideExtremum, TideSeries } from '@/core/feeds/coops-predictions';
import type { SurfDay } from '@/activities/surf/policy';
import { STATE_PRESENTATION } from '@/activities/surf/states';

/**
 * One local day of tide, drawn server-side as plain SVG.
 *
 * No charting library: the whole drawing is a few paths, some rules and some
 * labels, and a library would add a client bundle to render something that never
 * changes after paint.
 *
 * ---------------------------------------------------------------------------
 * The one drawing difference that matters
 * ---------------------------------------------------------------------------
 *
 * Tidepool's chart draws its floor as a DASHED LINE and shades one vertical
 * window. A line is the right mark for a floor: the claim is "under this", and a
 * line has an under.
 *
 * A band has no under. Drawn as two lines it reads as two independent
 * thresholds, and a reader has to hold in their head that the interesting region
 * is between them -- which is precisely the misreading that makes someone think
 * a tide near 3.4 ft is nearly out of luck when it is comfortably inside. So the
 * band is a HORIZONTAL SHADED REGION and the sessions are the vertical ones, and
 * where they intersect is where the curve is. That intersection is the whole
 * content of the page, and it is the one thing a chart can say that a table
 * cannot.
 *
 * The SVG carries `role="img"` and a one-sentence label, and the day's turning
 * points and sessions are repeated underneath as real tables. A chart is not
 * readable by a screen reader however well it is labelled.
 */

const WIDTH = 760;
const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 30, left: 38 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const PLOT_W = WIDTH - PAD.left - PAD.right;

export function SurfDayChart({
  daySeries,
  extrema,
  day,
  dayStartMs,
  dayEndMs,
  timeZone,
  nowMs,
  isToday,
  spotName,
  dateLabel,
  band,
}: {
  daySeries: TideSeries;
  extrema: readonly TideExtremum[];
  /** null when the day could not be evaluated. The curve still draws. */
  day: SurfDay | null;
  dayStartMs: number;
  dayEndMs: number;
  timeZone: string;
  nowMs: number;
  isToday: boolean;
  spotName: string;
  dateLabel: string;
  /**
   * The band. Passed in rather than read off `day`, because a day that could not
   * be evaluated still has a curve worth drawing and the band is what makes the
   * curve mean anything. Reading `day.detail.band` would have drawn the chart with no
   * band in exactly the case a reader most needs to see where it sits.
   */
  band: { minFt: number; maxFt: number };
}) {
  if (daySeries.samples.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border-strong)] p-4 text-meta text-[var(--text-dimmer)]">
        No prediction samples for this day, so no chart is drawn. This means unknown, not flat.
      </p>
    );
  }

  const heights = daySeries.samples.map((s) => s.ft);
  // Both band edges must always be on the chart even when the tide never
  // reaches them -- that is exactly the `out-of-band` case, and an edge
  // off-canvas would leave no way to see how far off the day was.
  const rawMin = Math.min(...heights, band.minFt);
  const rawMax = Math.max(...heights, band.maxFt);
  const span = Math.max(0.5, rawMax - rawMin);
  const yMin = rawMin - span * 0.12;
  const yMax = rawMax + span * 0.12;

  const x = (tMs: number) => PAD.left + ((tMs - dayStartMs) / (dayEndMs - dayStartMs)) * PLOT_W;
  const y = (ft: number) => PAD.top + (1 - (ft - yMin) / (yMax - yMin)) * PLOT_H;
  const clampX = (tMs: number) => Math.min(PAD.left + PLOT_W, Math.max(PAD.left, x(tMs)));

  const curve = daySeries.samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.tMs).toFixed(2)} ${y(s.ft).toFixed(2)}`)
    .join(' ');

  const area =
    `M${x(daySeries.samples[0]!.tMs).toFixed(2)} ${(PAD.top + PLOT_H).toFixed(2)} ` +
    daySeries.samples.map((s) => `L${x(s.tMs).toFixed(2)} ${y(s.ft).toFixed(2)}`).join(' ') +
    ` L${x(daySeries.samples[daySeries.samples.length - 1]!.tMs).toFixed(2)} ${(PAD.top + PLOT_H).toFixed(2)} Z`;

  /** Three-hourly ticks across the local day. */
  const ticks = Array.from({ length: 9 }, (_, i) => dayStartMs + ((dayEndMs - dayStartMs) * i) / 8);

  const bandTopY = y(band.maxFt);
  const bandBottomY = y(band.minFt);

  const label =
    `Tide chart for ${spotName} on ${dateLabel}. ` +
    `${extrema.length} turning points, from ${formatHeight(Math.min(...extrema.map((e) => e.ft)))} to ` +
    `${formatHeight(Math.max(...extrema.map((e) => e.ft)))} feet. ` +
    `The surf band is ${formatThreshold(band.minFt)} to ${formatThreshold(band.maxFt)} feet. ` +
    (day
      ? `${day.windows.length === 0 ? 'The tide never enters it' : `${day.windows.length} session${day.windows.length === 1 ? '' : 's'}`}. ` +
        `${STATE_PRESENTATION[day.state].spoken}. ${day.reason}`
      : 'This day could not be evaluated.') +
    ' The turning points are listed in the table below this chart' +
    (day && day.windows.length > 0 ? ', and the sessions in a second table under that one.' : '.');

  return (
    <figure className="m-0">
      {/*
        The chart is never scaled below 1:1, and never far above it. Text inside
        a viewBox scales with the box, so min-width equal to the viewBox width
        pins the floor of that scale at exactly 1.0 -- the 11-unit labels render
        at 11px, the same --text-meta as every other caption -- and max-width
        caps the ceiling near 1.18. Below 600px the chart scrolls inside its
        container instead of shrinking into illegibility.
      */}
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full min-w-[760px] max-w-[900px] rounded-md border border-[var(--border)] bg-[var(--surface-raised)]"
        >
          {/* Night, before sunrise and after sunset. */}
          {day ? (
            <>
              <rect
                x={PAD.left}
                y={PAD.top}
                width={Math.max(0, clampX(day.sunriseMs) - PAD.left)}
                height={PLOT_H}
                style={{ fill: 'var(--chart-night)', opacity: 'var(--chart-night-opacity)' }}
              />
              <rect
                x={clampX(day.sunsetMs)}
                y={PAD.top}
                width={Math.max(0, PAD.left + PLOT_W - clampX(day.sunsetMs))}
                height={PLOT_H}
                style={{ fill: 'var(--chart-night)', opacity: 'var(--chart-night-opacity)' }}
              />
            </>
          ) : null}

          {/*
            The band, drawn as a region rather than as two thresholds. Under the
            sessions and under the curve, because it is the backdrop they are
            read against.
          */}
          <rect
            x={PAD.left}
            y={bandTopY}
            width={PLOT_W}
            height={Math.max(0, bandBottomY - bandTopY)}
            fill="var(--color-accent)"
            opacity="0.10"
          />
          <line
            x1={PAD.left}
            y1={bandTopY}
            x2={PAD.left + PLOT_W}
            y2={bandTopY}
            stroke="var(--color-accent)"
            strokeWidth="1.25"
            strokeDasharray="5 3"
          />
          <line
            x1={PAD.left}
            y1={bandBottomY}
            x2={PAD.left + PLOT_W}
            y2={bandBottomY}
            stroke="var(--color-accent)"
            strokeWidth="1.25"
            strokeDasharray="5 3"
          />
          <text
            x={PAD.left + PLOT_W - 3}
            y={bandTopY - 5}
            textAnchor="end"
            fontSize="11.5"
            fill="var(--color-accent)"
            fontWeight="600"
            paintOrder="stroke"
            stroke="var(--surface-raised)"
            strokeWidth="3.5"
            strokeLinejoin="round"
          >
            band {formatThreshold(band.minFt)}–{formatThreshold(band.maxFt)} ft
          </text>

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

          {/*
            The usable part of each session. One colour for all of them --
            tinting by state would paint the day's verdict across the chart,
            which is the thing every other surface here refuses to do.

            Drawn only where usable minutes survive the daylight and gate clips,
            so a session entirely in the dark shows as a gap between the band and
            the shading rather than as a claim that it was available.
          */}
          {day?.windows.map((session, i) =>
            session.usableEndMs > session.usableStartMs ? (
              <g key={i}>
                <rect
                  x={clampX(session.usableStartMs)}
                  y={PAD.top}
                  width={Math.max(
                    0,
                    clampX(session.usableEndMs) - clampX(session.usableStartMs),
                  )}
                  height={PLOT_H}
                  fill="var(--color-window)"
                  opacity="0.18"
                />
                <line
                  x1={clampX(session.usableStartMs)}
                  y1={PAD.top}
                  x2={clampX(session.usableStartMs)}
                  y2={PAD.top + PLOT_H}
                  stroke="var(--color-window)"
                  strokeWidth="1.5"
                />
                <line
                  x1={clampX(session.usableEndMs)}
                  y1={PAD.top}
                  x2={clampX(session.usableEndMs)}
                  y2={PAD.top + PLOT_H}
                  stroke="var(--color-window)"
                  strokeWidth="1.5"
                />
              </g>
            ) : null,
          )}

          <path d={area} fill="var(--text)" opacity="0.07" />
          <path d={curve} fill="none" stroke="var(--text)" strokeWidth="1.75" opacity="0.75" />

          {/* Every turning point, marked and labelled. */}
          {extrema.map((e) => {
            const cx = x(e.tMs);
            const cy = y(e.ft);
            const above = e.kind === 'low';
            return (
              <g key={e.tMs}>
                <circle cx={cx} cy={cy} r="3.2" fill="var(--text)" />
                {/*
                  Knockout halo rather than a repositioning rule. These labels can
                  land on a gridline, on a band edge, on a session boundary or on
                  the curve itself; paint-order="stroke" gives each glyph its own
                  background so it stays legible on any of them without moving
                  from the point it labels.
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
        Shaded ends are night. The horizontal band is the workable tide range; the vertical bands
        are the sessions it produced, already clipped to daylight and to any gate. Where the two
        overlap the curve is where the tide is in the band and the light is up. Predictions are
        astronomical and exclude weather-driven surge, and the band itself is an uncalibrated
        author estimate applied identically to every spot in the corridor.
      </figcaption>

      <ExtremaTable extrema={extrema} band={band} timeZone={timeZone} />
      {day && day.windows.length > 0 ? (
        <SessionTable day={day} timeZone={timeZone} />
      ) : null}
    </figure>
  );
}

/** The chart's turning points as a table, for anyone the SVG cannot serve. */
function ExtremaTable({
  extrema,
  band,
  timeZone,
}: {
  extrema: readonly TideExtremum[];
  band: { minFt: number; maxFt: number };
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
          <th scope="col" className="pb-1 font-medium">Against the band</th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {extrema.map((e) => (
          <tr key={e.tMs} className="border-t border-[var(--border)]">
            <td className="py-1 pr-3">{e.kind === 'low' ? 'Low' : 'High'}</td>
            <td className="py-1 pr-3">{formatClock(e.tMs, timeZone)}</td>
            <td className="py-1 pr-3">{formatHeight(e.ft)} ft</td>
            <td className="py-1">
              {/*
                Three answers, not two. A floor has "under" and "over"; a band has
                a third case, and it is the one a reader is looking for.
              */}
              {e.ft <= band.minFt
                ? `${(band.minFt - e.ft).toFixed(1)} ft below`
                : e.ft >= band.maxFt
                  ? `${(e.ft - band.maxFt).toFixed(1)} ft above`
                  : 'inside'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The sessions as a table.
 *
 * The part of this page a tidepool day has no equivalent for: there is one
 * window there and a paragraph carries it. Here the count varies, and a list
 * that varies in length wants a table.
 */
function SessionTable({ day, timeZone }: { day: SurfDay; timeZone: string }) {
  return (
    <table className="mt-4 w-full text-left text-data">
      <caption className="pb-1.5 text-left text-meta text-[var(--text-dim)]">
        {day.windows.length === 1
          ? 'The one session the band produced'
          : `The ${day.windows.length} sessions the band produced`}
      </caption>
      <thead>
        <tr className="text-[var(--text-dimmer)]">
          <th scope="col" className="pr-3 pb-1 font-medium">In the band</th>
          <th scope="col" className="pr-3 pb-1 font-medium">Usable</th>
          <th scope="col" className="pr-3 pb-1 font-medium">Length</th>
          <th scope="col" className="pb-1 font-medium">Around</th>
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {day.windows.map((session, i) => (
          <tr key={i} className="border-t border-[var(--border)]">
            <td className="py-1 pr-3">
              {session.continuesBefore ? '‹' : ''}
              {formatClock(session.startMs, timeZone)}–{formatClock(session.endMs, timeZone)}
              {session.continuesAfter ? '›' : ''}
            </td>
            <td className="py-1 pr-3">
              {session.usableEndMs > session.usableStartMs
                ? `${formatClock(session.usableStartMs, timeZone)}–${formatClock(session.usableEndMs, timeZone)}`
                : /*
                     Not a dash. A session with nothing usable in it was taken by
                     daylight or by a gate, and which one is the day's whole
                     verdict -- `dark` against `closed`.
                   */
                  session.gateBlocked
                  ? 'gate shut'
                  : 'no daylight'}
            </td>
            <td className="py-1 pr-3">
              {session.usableMinutes > 0 ? formatDuration(session.usableMinutes) : '—'}
            </td>
            <td className="py-1">{sessionAnchorLabel(session) ?? 'no turn — a pass through'}</td>
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
