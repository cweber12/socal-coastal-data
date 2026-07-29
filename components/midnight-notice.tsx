'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tells the reader when the local day has rolled past the one this page was
 * evaluated for, and leaves the decision to refresh with them.
 *
 * The alternative -- quietly re-rendering the grid at midnight -- shifts every
 * column one place left. Anyone mid-click lands on a different day than the one
 * they aimed at, and anyone reading a window length gets a new number with no
 * indication it changed. So the grid is left exactly as evaluated and this says
 * so.
 *
 * The notice is `position: fixed`, so it does not push the grid down when it
 * appears. A banner that reflows the page to announce that the page should not
 * reflow would be self-defeating.
 *
 * Reading the clock only ever happens in this component. Everything else takes
 * `now` as an argument from the server render, which is why a stale page is
 * detectable at all: there is one evaluation instant and it is on the page.
 */
export function MidnightNotice({
  evaluatedAtMs,
  timeZone,
  evaluatedDateLabel,
}: {
  evaluatedAtMs: number;
  timeZone: string;
  evaluatedDateLabel: string;
}) {
  const router = useRouter();
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    /** The instant the local day after `evaluatedAtMs` begins. */
    const nextMidnight = (): number => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(evaluatedAtMs));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);

      // Tomorrow's local midnight, resolved through the zone rather than by
      // adding 24 h: the local day is 23 or 25 hours long across a DST change.
      const naive = Date.UTC(get('year'), get('month') - 1, get('day') + 1, 0, 0, 0);
      const offsetAt = (ms: number) => {
        const p = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).formatToParts(new Date(ms));
        const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
        return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) - ms;
      };
      const firstPass = naive - offsetAt(naive);
      return naive - offsetAt(firstPass);
    };

    const target = nextMidnight();
    const delay = target - Date.now();

    // Already past it: the tab was left open, or restored from the back-forward
    // cache, or the page came from a CDN. Say so immediately.
    if (delay <= 0) {
      setRolled(true);
      return;
    }

    // setTimeout is capped at ~24.9 days, and the longest gap here is one day, so
    // a single timer is safe. It does not fire while the tab is suspended, hence
    // the visibility check below.
    const timer = window.setTimeout(() => setRolled(true), delay);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= target) setRolled(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [evaluatedAtMs, timeZone]);

  if (!rolled) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2.5 shadow-lg"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-ui">
          <strong>The date has changed.</strong> This page is still showing the week from{' '}
          {evaluatedDateLabel}, and its first column is no longer today. Nothing has moved on
          its own — reload when you are ready.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="shrink-0 rounded border border-[var(--border-strong)] bg-[var(--surface-sunken)] px-3 py-1.5 text-ui font-medium hover:brightness-110"
        >
          Roll the window forward
        </button>
      </div>
    </div>
  );
}
