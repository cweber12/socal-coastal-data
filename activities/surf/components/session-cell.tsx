import Link from 'next/link';

import { FlagBadge } from '@/activities/surf/components/flag-badge';
import {
  cellAriaLabel,
  flagBadgeLabel,
  formatHeight,
  sessionAnchorLabel,
  unevaluatedAriaLabel,
} from '@/activities/surf/labels';
import { formatClock, formatDuration, formatLocalDate, type LocalDate } from '@/core/time';
import { sessionLighting, type SurfDay, type SurfSession } from '@/activities/surf/policy';
import { surfDayPath } from '@/activities/surf/routes';

/**
 * One spot on one day: the sessions the band produced.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a copy of tidepool's cell with different numbers
 * ---------------------------------------------------------------------------
 *
 * A tidepool cell shows one instant and one derived number: the low, the high
 * after it, and the low's distance from the reef floor. There is exactly one of
 * each, always, so the layout is fixed and the cell can be read at a glance
 * because every cell has the same shape.
 *
 * A surf cell shows a LIST whose length varies day to day and spot to spot --
 * one session on a quiet day, four when the range is small. Fixed-shape reading
 * is not available, so the cell leads with the count and then prints the
 * sessions as rows. The count is the part that scans down a column.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does not show
 * ---------------------------------------------------------------------------
 *
 * The state. Same argument tidepool's window-cell.tsx makes, and it lands harder
 * here: a coloured verdict reads as a measurement, and every input to a surf
 * verdict is an author estimate over a zone with no measured fact. The state is
 * behind the badge, and it is in the aria-label in full -- demoting it visually
 * must not demote it for a screen reader, which cannot open a popover to find
 * out what a cell means.
 *
 * The lighting is per SESSION rather than per cell, which tidepool has no need
 * for: a surf day routinely carries a dawn session and an evening one, and one
 * background for the whole cell would have to pick a side and be wrong about
 * half of it.
 */
export function SessionCell({
  spotSlug,
  spotName,
  day,
  timeZone,
}: {
  spotSlug: string;
  spotName: string;
  day: SurfDay;
  timeZone: string;
}) {
  // The date is formatted twice on purpose: once for the badge's dashed-ident
  // id, and once inside the route helper, which owns the URL's date format.
  const dateKey = formatLocalDate(day.date);
  const href = surfDayPath(spotSlug, day.date);

  return (
    <div className="relative h-full">
      <Link
        href={href}
        aria-label={cellAriaLabel(spotName, day, timeZone)}
        className="cell-link block h-full rounded-md py-1.5 pl-2 pr-6 text-data no-underline transition-colors"
      >
        {/* aria-hidden throughout: the label above already says all of this in prose. */}
        <span aria-hidden className="block">
          {day.sessions.length === 0 ? (
            <OutOfBand day={day} />
          ) : (
            <>
              {day.sessions.map((session, i) => (
                <SessionLine
                  key={i}
                  session={session}
                  day={day}
                  timeZone={timeZone}
                  isBest={session === day.best}
                />
              ))}
            </>
          )}
        </span>
      </Link>

      <span className="absolute right-1 top-1">
        <FlagBadge
          id={`grid-${spotSlug}-${dateKey}`}
          label={flagBadgeLabel(spotName, day, timeZone)}
          day={day}
        />
      </span>
    </div>
  );
}

/**
 * One session: when it runs, how long it is usable for, and what it brackets.
 *
 * The skin is on the LINE, not on the cell, because lighting is a property of
 * the session. A cell with a dawn session and an evening one shows two skins,
 * which is what is true.
 */
function SessionLine({
  session,
  day,
  timeZone,
  isBest,
}: {
  session: SurfSession;
  day: SurfDay;
  timeZone: string;
  isBest: boolean;
}) {
  const anchor = sessionAnchorLabel(session);
  const usable = day.isToday ? (session.minutesRemaining ?? 0) : session.usableMinutes;

  return (
    <span
      data-lighting={sessionLighting(session, day)}
      className={[
        'cell-skin mt-0.5 block rounded border px-1 py-0.5 first:mt-0',
        // Weight, never colour. Colour is what turned the old tidepool state
        // grid into 56 confident-looking refusals, and the argument transfers
        // whole: this marks which session the verdict is about, not how sure
        // anyone is about it.
        isBest ? 'font-semibold' : 'font-normal',
      ].join(' ')}
    >
      <span className="flex items-baseline justify-between gap-1 whitespace-nowrap font-mono tabular-nums">
        <span>
          {/*
            The leading edge marker. `‹` when the session was already running at
            local midnight, so a reader is not told the tide crossed the band
            edge at exactly 00:00 -- which is what a bare "12:00 am" would say.
          */}
          {session.continuesBefore ? (
            <span className="text-[0.8em] text-[var(--cell-fg-dimmer,var(--text-dimmer))]">‹</span>
          ) : null}
          {formatClock(session.startMs, timeZone)}
          <span className="text-[var(--cell-fg-dim,var(--text-dim))]">–</span>
          {formatClock(session.endMs, timeZone)}
          {session.continuesAfter ? (
            <span className="text-[0.8em] text-[var(--cell-fg-dimmer,var(--text-dimmer))]">›</span>
          ) : null}
        </span>
        <span className="text-[0.9em] text-[var(--cell-fg-dim,var(--text-dim))]">
          {usable > 0 ? formatDuration(usable) : '—'}
        </span>
      </span>

      {anchor ? (
        <span className="block text-[0.85em] text-[var(--cell-fg-dim,var(--text-dim))]">
          {anchor}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A day the tide never spent inside the band.
 *
 * Prints the day's range against the band rather than a bare "none", so the
 * reader can see WHICH side it missed on and by how much. That is the fact
 * tidepool's `above-floor` cell does not have to convey, because a floor is
 * one-sided and this is not: a day can be unusable at dead low and unusable at
 * the top of the tide, and the two want opposite things from the week ahead.
 */
function OutOfBand({ day }: { day: SurfDay }) {
  return (
    <span className="block font-mono tabular-nums text-[var(--text-dim)]">
      <span className="block">
        {formatHeight(day.dayLowFt)}–{formatHeight(day.dayHighFt)} ft
      </span>
      <span className="mt-0.5 block text-[0.85em] text-[var(--text-dimmer)]">
        {day.dayLowFt >= day.band.maxFt ? 'never drops in' : 'never rises in'}
      </span>
    </span>
  );
}

/**
 * A day that could not be evaluated.
 *
 * Not a ninth state -- an absence. No skin, because there is no session to say
 * anything about the lighting of, and not a link, because there is nothing to
 * show.
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
