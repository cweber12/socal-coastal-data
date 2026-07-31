import { formatStamp } from '@/core/time';
import type { Notice } from '@/core/notice';

/**
 * The evaluation stamp.
 *
 * On every page, because every page is a judgement made at one instant against
 * data of a particular age, and a tide grid with no timestamp invites being read
 * as live. It names the zone: a bare "4:12 pm" is the ambiguity the whole time
 * module exists to remove.
 */
export function EvaluationStamp({
  evaluatedAtMs,
  timeZone,
  extra,
}: {
  evaluatedAtMs: number;
  timeZone: string;
  extra?: string;
}) {
  return (
    <p className="text-meta text-[var(--text-dimmer)]">
      Evaluated <time dateTime={new Date(evaluatedAtMs).toISOString()}>{formatStamp(evaluatedAtMs, timeZone)}</time>
      {extra ? ` · ${extra}` : ''}
    </p>
  );
}

/**
 * Everything that went wrong, shown rather than swallowed.
 *
 * A dead buoy, a substituted buoy, a day that would not evaluate, an NDBC layout
 * that has drifted. None of these are fatal to the page, and all of them change
 * how much weight the numbers deserve, so they are on the page rather than in a
 * server log.
 */
export function Notices({ notices }: { notices: readonly Notice[] }) {
  if (notices.length === 0) return null;

  const drift = notices.filter((n) => n.severity === 'drift');
  const warn = notices.filter((n) => n.severity === 'warn');
  const info = notices.filter((n) => n.severity === 'info');

  return (
    <section aria-labelledby="notices-heading" className="mt-6">
      <h2 id="notices-heading" className="text-ui font-semibold tracking-wide uppercase text-[var(--text-dim)]">
        Data notices ({notices.length})
      </h2>

      {drift.length > 0 ? (
        <div
          className="tint-panel mt-2 rounded-md border p-3"
          style={{ ['--tint-color' as string]: 'var(--color-alert)' }}
        >
          <p className="text-ui font-semibold">
            An upstream format has changed. Wave height is being reported as unknown rather than
            guessed at, so no day can read as a pass on swell.
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-meta">
            {drift.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {warn.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-meta text-[var(--text-dim)]">
          {warn.map((n, i) => (
            <li key={i}>{n.message}</li>
          ))}
        </ul>
      ) : null}

      {info.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-meta text-[var(--text-dimmer)]">
            {info.length} more upstream {info.length === 1 ? 'note' : 'notes'}
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-meta text-[var(--text-dimmer)]">
            {info.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Predictions could not be fetched.
 *
 * Named as a failure rather than rendered as an empty grid. An empty grid reads
 * as "no windows this week", which is a claim about the tide; this is a claim
 * about the connection.
 */
export function UpstreamFailure({
  failure,
  what,
}: {
  failure: { message: string; url: string };
  what: string;
}) {
  return (
    <div
      className="tint-panel rounded-md border p-4"
      style={{ ['--tint-color' as string]: 'var(--color-alert)' }}
    >
      <h2 className="text-section font-semibold">{what} could not be loaded</h2>
      <p className="mt-1.5 text-ui">
        No tide window is shown, which means unknown — not that there are no windows.
      </p>
      <p className="mt-2 font-mono text-meta break-all text-[var(--text-dim)]">
        {failure.message}
      </p>
      {failure.url ? (
        <p className="mt-1.5 font-mono text-meta break-all text-[var(--text-dimmer)]">
          {failure.url}
        </p>
      ) : null}
    </div>
  );
}
