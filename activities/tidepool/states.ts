/**
 * Tidepool's states, and how each one is presented.
 *
 * Split out of the predicate in #123 so the two can be read apart: this file
 * says WHICH verdicts exist and what a reader is shown for each, and policy.ts
 * says how a day arrives at one.
 *
 * Nothing here depends on `WindowResult`, deliberately. The dependency runs one
 * way -- policy.ts imports these states -- so that #130 can lift the shared
 * gate states into core/window/states.ts without first untangling a cycle.
 * `above-floor` is the only one of the seven that is genuinely tidepool's: it is
 * what THIS activity's height predicate emits. The other six are gate states
 * that any activity would need.
 */

/* ===========================================================================
 * Types
 * ========================================================================= */

/**
 * The seven states, in the order they are tested. Certain verdicts come before
 * uncertain ones.
 *
 *   above-floor  The low never reaches the floor. The reef does not surface.
 *   closed       The window falls outside the operator's gate hours.
 *   dark         The window and the available daylight do not overlap.
 *   veto         A known swell reading is over the ceiling.
 *   brief        There is a window, but under MIN_WINDOW_MINUTES of it.
 *   swell-tbd    Everything else clears, but the swell is unknown.
 *   go           Clears everything.
 *
 * Three orderings are deliberate:
 *
 *   `closed` sits ABOVE `dark` because a shut gate is decisive whatever the
 *   light, and because NPS scopes its own Cabrillo threshold by park hours --
 *   the Superintendent's Compendium binds at low tides "0.7 or lower during park
 *   hours". The two rarely conflict in practice: the case this exists for is a
 *   summer 6 a.m. low, which is broad daylight and gated. `dark` still fires
 *   whenever the daylight clip is what emptied the window, so the two causes are
 *   never conflated -- see `gateBlocked`.
 *
 *   `brief` sits BELOW `veto` because a swell over the ceiling is a settled no,
 *   and there is no point qualifying a no with how long it would have been.
 *
 *   `swell-tbd` sits BELOW `brief` because a 20-minute window is a settled fact
 *   about the tide and should be reported as such rather than deferred to an
 *   unknown. It sits ABOVE `go` so that an unknown can never render as a pass.
 *
 * `closed` applies only where an operator publishes gate hours -- one spot of 26
 * today. Everywhere else `gate` is null and the predicate is unchanged. It is a
 * clip, not a fifth gate.
 */
export type WindowState =
  | 'above-floor'
  | 'closed'
  | 'dark'
  | 'veto'
  | 'brief'
  | 'swell-tbd'
  | 'go';

export const WINDOW_STATES: readonly WindowState[] = [
  'above-floor',
  'closed',
  'dark',
  'veto',
  'brief',
  'swell-tbd',
  'go',
];

/* ===========================================================================
 * Presentation helpers, kept next to the states they describe
 * ========================================================================= */

export interface StatePresentation {
  /** Short label, shown where the state is disclosed rather than on a cell face. */
  label: string;
  /** Word used in the aria-label sentence. */
  spoken: string;
  /**
   * Glyph. It is not a substitute for the word -- both are always shown together
   * -- it is a second channel so the label is recognisable at a glance.
   *
   * None of these may be `▲` or `▼`. Those two are the tide arrows a cell puts
   * against its high and its low, and a state glyph that collides with one reads
   * as a second, contradictory tide reading in the same cell.
   */
  glyph: string;
  /** Whether this state means "you could go". */
  usable: boolean;
}

/**
 * How a state is worded when it is disclosed.
 *
 * No colour here any more. The states used to carry one each, painted across the
 * whole cell, and on an ordinary week that produced 56 coloured verdicts from a
 * predicate resting on two uncalibrated numbers -- a floor nobody has field-checked
 * and a swell ceiling that is a corridor-wide guess. The colour asserted a
 * confidence the maths does not have. Until the thresholds are calibrated the
 * state is secondary information: it lives behind a badge, in words.
 */
export const STATE_PRESENTATION: Readonly<Record<WindowState, StatePresentation>> = {
  go: { label: 'Go', spoken: 'go', glyph: '●', usable: true },
  brief: { label: 'Brief', spoken: 'brief', glyph: '◐', usable: false },
  veto: { label: 'Swell', spoken: 'vetoed on swell', glyph: '✕', usable: false },
  closed: { label: 'Gate shut', spoken: 'outside gate hours', glyph: '⛔', usable: false },
  dark: { label: 'No light', spoken: 'outside daylight', glyph: '☾', usable: false },
  'above-floor': {
    // "Covered", not "too high". The cell already prints the height next to a ▼,
    // so a reader can see for themselves that it is high; what the state adds is
    // what that means -- the reef stays under water.
    label: 'Covered',
    spoken: 'above the floor',
    glyph: '≈',
    usable: false,
  },
  'swell-tbd': { label: 'Swell TBD', spoken: 'swell unknown', glyph: '?', usable: false },
};

/**
 * Whether the low this result reports falls in daylight.
 *
 * This is what a cell's background says, and it is deliberately the plainest fact
 * available: is the clock time printed in the cell before sunset and after
 * sunrise. It is NOT the `dark` state. `dark` is a verdict about the whole
 * window -- a low at 5:30 pm can be in daylight while the usable part of its
 * window is not -- and verdicts are exactly what the background stopped carrying.
 *
 * Sunrise and sunset are computed to about 30 s, so a low within a minute of
 * either edge could be shaded the other way. Nothing is decided on this: it is a
 * background, and the time itself is printed next to it.
 */
export type CellLighting = 'day' | 'night';
