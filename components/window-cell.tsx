import Link from 'next/link';

import { cellAriaLabel, formatHeight, unevaluatedAriaLabel } from '@/lib/labels';
import { formatClock, formatDuration, formatLocalDate, type LocalDate } from '@/lib/time';
import { STATE_PRESENTATION, type WindowResult } from '@/lib/windows';

/**
 * One spot on one day.
 *
 * A link, not a button: it navigates to the day chart, and a real anchor gets
 * middle-click, open-in-new-tab and a status-bar preview for free. The row's
 * disclosure toggle IS a button, and the two are siblings in the row rather than
 * nested, so there is never an interactive element inside another one.
 *
 * ---------------------------------------------------------------------------
 * What the cell leads with, and why it changed
 * ---------------------------------------------------------------------------
 *
 * The tide is the headline; the state is a footnote on it. The first draft had
 * this the other way round -- state label across the top in its own colour, tide
 * underneath -- and on an ordinary week that reads as a wall of verdicts. The
 * grid's own worked example: over the seven days from 2026-07-28, 49 of 56 cells
 * came back `above-floor` and the other 7 `dark`. Fifty-six coloured refusals
 * carrying, between them, no information a reader could act on.
 *
 * So the two tide lines come first at full contrast, and the state sits under
 * them, small, with only its glyph tinted -- unless the state is USABLE, which is
 * the one a reader is scanning for and the one worth catching the eye. The
 * background tint still carries state across the whole cell either way.
 *
 * State is carried by three channels, not one: a tint, a glyph, and the word
 * itself. Colour alone fails for anyone who cannot distinguish these hues, and
 * fails entirely for a screen reader, which gets the full sentence from
 * cellAriaLabel. Demoting the label changes its size, never its presence.
 */
export function WindowCell({
  spotSlug,
  spotName,
  result,
  timeZone,
  compact = false,
}: {
  spotSlug: string;
  spotName: string;
  result: WindowResult;
  timeZone: string;
  compact?: boolean;
}) {
  const presentation = STATE_PRESENTATION[result.state];
  const href = `/spot/${spotSlug}/${formatLocalDate(result.date)}`;

  return (
    <Link
      href={href}
      aria-label={cellAriaLabel(spotName, result, timeZone)}
      title={result.reason}
      className={[
        'state-tint block h-full rounded-md border px-2 py-1.5 no-underline',
        'transition-colors hover:brightness-105',
        compact ? 'text-[0.7rem]' : 'text-[0.72rem]',
      ].join(' ')}
      style={{ ['--state' as string]: presentation.colorVar }}
    >
      {/* aria-hidden throughout: the label above already says all of this in prose. */}
      <span aria-hidden className="block">
        <TideLine
          arrow="▼"
          heightFt={result.lowFt}
          tMs={result.lowMs}
          timeZone={timeZone}
          emphasis
        />

        {result.nextHighMs !== null && result.nextHighFt !== null ? (
          <TideLine
            arrow="▲"
            heightFt={result.nextHighFt}
            tMs={result.nextHighMs}
            timeZone={timeZone}
          />
        ) : null}

        <span
          className={[
            'mt-1 flex items-center gap-1 text-[0.9em]',
            presentation.usable ? 'font-medium' : 'text-[var(--text-dimmer)]',
          ].join(' ')}
          style={presentation.usable ? { color: presentation.colorVar } : undefined}
        >
          <span className="leading-none" style={{ color: presentation.colorVar }}>
            {presentation.glyph}
          </span>
          <span className="truncate">{presentation.label}</span>
        </span>

        {result.isToday && result.minutesRemaining !== null && result.minutesRemaining > 0 ? (
          <span className="mt-0.5 block font-medium" style={{ color: presentation.colorVar }}>
            {formatDuration(result.minutesRemaining)} left
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * One tide event: an arrow, a height, a clock time.
 *
 * The arrow is which way the tide is going at that turn -- ▼ for the low, ▲ for
 * the high -- and it is the reason the low needed one at all. Without it the two
 * lines are a pair of unlabelled numbers, and which of them is the low is exactly
 * the thing a reader is trying to find. Shared with the week ribbon so the two
 * views cannot drift into showing tides differently.
 *
 * Both lines are tabular mono so heights and clock times line up down a column,
 * which is what makes a seven-day row scannable at all. `formatHeight` gives a
 * true U+2212 minus so a negative height stays column-aligned with a positive
 * one.
 */
export function TideLine({
  arrow,
  heightFt,
  tMs,
  timeZone,
  emphasis = false,
}: {
  arrow: '▼' | '▲';
  heightFt: number;
  tMs: number;
  timeZone: string;
  /** The low gets it: this is the event the whole page is about. */
  emphasis?: boolean;
}) {
  return (
    <span
      className={[
        'flex items-baseline gap-1 font-mono tabular-nums',
        emphasis ? 'text-[1.05em] font-semibold' : 'mt-0.5 text-[0.95em] text-[var(--text-dim)]',
      ].join(' ')}
    >
      <span className="text-[0.8em] text-[var(--text-dimmer)]">{arrow}</span>
      <span>{formatHeight(heightFt)}</span>
      <span className="text-[var(--text-dim)]">{formatClock(tMs, timeZone)}</span>
    </span>
  );
}

/**
 * A day that could not be evaluated.
 *
 * Not a seventh state -- an absence. It is rendered as visibly different from
 * every real state so it cannot be mistaken for one, and it is not a link,
 * because there is nothing to show.
 */
export function UnevaluatedCell({
  spotName,
  date,
  dateMs,
  timeZone,
}: {
  spotName: string;
  date: LocalDate;
  dateMs: number;
  timeZone: string;
}) {
  return (
    <div
      role="note"
      aria-label={unevaluatedAriaLabel(spotName, date, timeZone, dateMs)}
      className="flex h-full items-center justify-center rounded-md border border-dashed border-[var(--border-strong)] px-2 py-1.5 text-[0.7rem] text-[var(--text-dimmer)]"
    >
      <span aria-hidden>not evaluated</span>
    </div>
  );
}
