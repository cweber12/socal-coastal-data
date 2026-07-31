/**
 * A disclosure a reader is shown alongside a verdict.
 *
 * Lifted out of the grid in #123, and the reason is a boundary rather than
 * tidiness. `core/components/disclosure.tsx` renders notices and nothing else,
 * which makes it a shell with no activity in it -- but it took this type from
 * the composer, and a core component importing an activity is the one edge
 * `scripts/check-boundaries.mjs` exists to forbid. Four lines with no activity
 * in them were holding a whole component on the wrong side of the line.
 *
 * The severities are what a reader is being told, not what went wrong
 * internally:
 *
 *   info   something worth knowing that does not weaken the number
 *   warn   the number stands, but it is doing less work than it appears to --
 *          a substituted buoy, a stale reading
 *   drift  an upstream returned something its pinned contract did not describe.
 *          Distinct from `warn` because drift means the stack's belief about a
 *          payload is now WRONG, and nobody has looked yet.
 */
export interface Notice {
  severity: 'info' | 'warn' | 'drift';
  message: string;
}
