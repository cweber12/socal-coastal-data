import Link from 'next/link';

import { FlagBadge } from '@/components/flag-badge';
import { cellAriaLabel, flagBadgeLabel, formatHeight, unevaluatedAriaLabel } from '@/lib/labels';
import { formatClock, formatDuration, formatLocalDate, type LocalDate } from '@/lib/time';
import { lowLighting, type WindowResult } from '@/lib/windows';

/**
 * One spot on one day.
 *
 * The link is not a button: it navigates to the day chart, and a real anchor gets
 * middle-click, open-in-new-tab and a status-bar preview for free. The row's
 * disclosure toggle IS a button, and the two are siblings in the row rather than
 * nested, so there is never an interactive element inside another one. The flag
 * badge is a third sibling, for the same reason.
 *
 * ---------------------------------------------------------------------------
 * What a cell shows, and what it stopped showing
 * ---------------------------------------------------------------------------
 *
 * It shows the tide: the low, the high that follows it, and -- through the
 * background -- whether that low lands in daylight or after dark. All of that is
 * observation. Every one of those numbers comes from a CO-OPS prediction or from
 * a sunrise computation, and a reader can act on them directly.
 *
 * It no longer shows the window state. The state used to be a tinted background
 * plus a word: "No light", "Swell TBD", "Covered". Two problems with that. The
 * first is volume -- over the seven days from 2026-07-28, 49 of 56 cells came
 * back `above-floor` and the other 7 `dark`, so the grid was 56 coloured
 * refusals carrying nothing a reader could act on. The second is confidence: a
 * red cell reads as a measurement, and the state behind it is decided against a
 * floor and a ceiling that are both uncalibrated estimates. Until those are real
 * the state is a footnote, and it now lives where footnotes live -- behind a
 * badge, closed.
 *
 * The state is still in the cell's aria-label in full. Demoting it visually must
 * not demote it for a screen reader, which cannot open a popover to find out what
 * a cell means.
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
  const dateKey = formatLocalDate(result.date);
  const href = `/spot/${spotSlug}/${dateKey}`;

  return (
    <CellShell
      lighting={lowLighting(result)}
      badge={
        <FlagBadge
          id={`grid-${spotSlug}-${dateKey}`}
          label={flagBadgeLabel(spotName, result, timeZone)}
          result={result}
        />
      }
    >
      <Link
        href={href}
        aria-label={cellAriaLabel(spotName, result, timeZone)}
        className={[
          'cell-link block h-full rounded-md py-1.5 pl-2 pr-6 no-underline transition-colors',
          compact ? 'text-meta' : 'text-data',
        ].join(' ')}
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

          {result.isToday && result.minutesRemaining !== null && result.minutesRemaining > 0 ? (
            <span className="mt-1 block font-medium">
              {formatDuration(result.minutesRemaining)} left
            </span>
          ) : null}
        </span>
      </Link>
    </CellShell>
  );
}

/**
 * The skinned box a cell's link and badge sit in.
 *
 * The skin lives here rather than on the link so the badge inherits it: the badge
 * has to be legible on a near-white day cell and on a dark night one, and it does
 * that by taking its colour from `--cell-fg-dim`, which only exists inside a
 * `.cell-skin`.
 *
 * Badge in the top right. That is where a badge goes, it is furthest from the
 * numbers the cell leads with, and it puts every badge in the grid on the same
 * rhythm so the affordance is learnable after one click. The link is padded on
 * that side so no tide text can run underneath it.
 *
 * Shared with the week ribbon: expanding a grid row and opening a spot page must
 * not produce two different-looking answers to the same question.
 */
export function CellShell({
  lighting,
  badge,
  children,
  className,
}: {
  lighting: 'day' | 'night';
  badge: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-lighting={lighting}
      className={['cell-skin relative h-full rounded-md border', className].filter(Boolean).join(' ')}
    >
      {children}
      <span className="absolute right-1 top-1">{badge}</span>
    </div>
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
 *
 * The dim tones come from the cell skin, falling back to the page ramp: a night
 * cell is genuinely dark and the page's --text-dim would disappear into it.
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
        emphasis
          ? 'text-[1.05em] font-semibold'
          : 'mt-0.5 text-[0.95em] text-[var(--cell-fg-dim,var(--text-dim))]',
      ].join(' ')}
    >
      <span className="text-[0.8em] text-[var(--cell-fg-dimmer,var(--text-dimmer))]">{arrow}</span>
      <span>{formatHeight(heightFt)}</span>
      <span className="text-[var(--cell-fg-dim,var(--text-dim))]">{formatClock(tMs, timeZone)}</span>
    </span>
  );
}

/**
 * A day that could not be evaluated.
 *
 * Not a seventh state -- an absence. It carries no skin, because there is no low
 * to say anything about the lighting of, and it is not a link, because there is
 * nothing to show.
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
      className="flex h-full items-center justify-center rounded-md border border-dashed border-[var(--border-strong)] px-2 py-1.5 text-ui text-[var(--text-dimmer)]"
    >
      <span aria-hidden>not evaluated</span>
    </div>
  );
}
