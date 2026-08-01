/**
 * Tidepool's states: the gate states it can reach, plus the one its own
 * predicate emits.
 *
 * Six of the seven come from `core/window/states.ts` and are not tidepool's in
 * any sense -- they are what the daylight clip, the operator gate, the swell
 * window, the duration gate and the unknown-input rule emit, for any activity.
 * `above-floor` is the only one that is genuinely this activity's: it is what
 * THIS height predicate emits when the low never gets under the floor.
 *
 * The seventh gate state, `flat`, is unreachable here and deliberately absent.
 * It needs a swell MINIMUM, and tidepool declares none: swell is a hazard on a
 * reef, not something to ride, so the gate is one-sided. policy.ts throws rather
 * than rendering a state with no row here.
 *
 * Nothing here depends on `WindowResult`, deliberately. The dependency runs one
 * way -- policy.ts imports these states -- which is what let the lift into
 * core/window/states.ts happen without first untangling a cycle.
 */

import {
  coreStatesIn,
  presentationFor,
  type CoreState,
  type StatePresentation,
} from '../../core/window/states';

export type { StatePresentation };
export { coreStatesIn };
export type { CellLighting } from '../../core/window/states';

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
 * `above-floor` sits at the top for the reason every predicate state does:
 * there was no window for a gate to shut, so nothing the gates have to say
 * applies. The relative order of the other six is the shared one, and
 * `states.test.ts` asserts this list did not quietly reorder it while inserting
 * `above-floor` at the front.
 *
 * `closed` applies only where an operator publishes gate hours -- one spot of 26
 * today. Everywhere else `gate` is null and the predicate is unchanged. It is a
 * clip, not a fifth gate.
 */
export type WindowState = Exclude<CoreState, 'flat'> | 'above-floor';

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
 * Presentation
 * ========================================================================= */

/**
 * How a state is worded when it is disclosed.
 *
 * The gate states take core's wording; `above-floor` is stated here because it
 * is stated nowhere else. No colour on any of them -- see core/window/states.ts
 * for why a coloured verdict asserts a confidence this predicate does not have.
 */
export const STATE_PRESENTATION = presentationFor(WINDOW_STATES, {
  'above-floor': {
    // "Covered", not "too high". The cell already prints the height next to a ▼,
    // so a reader can see for themselves that it is high; what the state adds is
    // what that means -- the reef stays under water.
    label: 'Covered',
    spoken: 'above the floor',
    glyph: '≈',
    usable: false,
  },
});
