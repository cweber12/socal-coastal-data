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
 * State is carried by three channels, not one: a tint, a glyph, and the word
 * itself. Colour alone fails for anyone who cannot distinguish these hues, and
 * fails entirely for a screen reader, which gets the full sentence from
 * cellAriaLabel.
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
        <span
          className="flex items-center gap-1 font-medium"
          style={{ color: presentation.colorVar }}
        >
          <span className="text-[0.85em] leading-none">{presentation.glyph}</span>
          <span className="truncate">{presentation.label}</span>
        </span>

        <span className="mt-1 flex items-baseline gap-1.5 font-mono">
          <span className="text-[1.05em] font-semibold tabular-nums">
            {formatHeight(result.lowFt)}
          </span>
          <span className="text-[var(--text-dim)]">{formatClock(result.lowMs, timeZone)}</span>
        </span>

        {result.nextHighMs !== null && result.nextHighFt !== null ? (
          <span className="mt-0.5 block font-mono text-[0.92em] text-[var(--text-dimmer)]">
            ▲ {formatHeight(result.nextHighFt)} {formatClock(result.nextHighMs, timeZone)}
          </span>
        ) : null}

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
