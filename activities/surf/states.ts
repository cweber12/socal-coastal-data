/**
 * Surf's states: the gate states it can reach, plus the one its own predicate
 * emits.
 *
 * Seven of the eight come from `core/window/states.ts`. `out-of-band` is the
 * only one that is genuinely this activity's, and it is the band's analogue of
 * tidepool's `above-floor` rather than the same state renamed: `above-floor` has
 * a direction and this does not. A tide can miss the band by being too low, and
 * the reason string says which, because "the reef stays covered" has no
 * equivalent here -- a spot can be unusable at dead low and unusable at the top
 * of the tide on the same day.
 *
 * `flat` IS a gate state, and it is reachable here because this activity
 * declares a swell minimum. That is the correction #129 forced on the spec:
 * decision 4 said "a ceiling emits `veto`", and a ceiling alone called a 0.4 ft
 * day `go`. The swell gate is a window read in two directions, and its two
 * answers are worded as different kinds of answer -- `veto` is "do not go",
 * `flat` is "there is nothing there". Tidepool passes no minimum and can never
 * reach it.
 *
 * Nothing here depends on `SurfDay`, on the same terms as tidepool and for the
 * same reason: the dependency runs one way, policy.ts imports these states.
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
 * The eight states, in the order they are tested. Certain verdicts come before
 * uncertain ones.
 *
 *   out-of-band  The tide never enters the band during the day.
 *   closed       Every session falls outside the operator's gate hours.
 *   dark         Every session falls outside daylight.
 *   veto         A known swell reading is over the ceiling.
 *   flat         A known swell reading is under the minimum.
 *   brief        There are sessions, but none reaches MIN_SESSION_MINUTES.
 *   swell-tbd    Everything else clears, but the swell is unknown.
 *   go           Clears everything.
 *
 * This is every gate state plus `out-of-band` at the front, which is where a
 * predicate state goes: there was nothing there for a gate to shut. The relative
 * order of the seven is the shared one, and `states.test.ts` asserts this list
 * did not quietly reorder it.
 */
export type SurfState = CoreState | 'out-of-band';

export const SURF_STATES: readonly SurfState[] = [
  'out-of-band',
  'closed',
  'dark',
  'veto',
  'flat',
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
 * Two rows are stated here. `out-of-band` because it is stated nowhere else, and
 * `veto` because a surfer and a tidepooler read the same ceiling differently:
 * over the ceiling is a hazard on a reef and a size call in the water.
 *
 * No colour, on the terms core/window/states.ts sets out. On this page the
 * argument is stronger than it is for tidepool -- tidepool at least has a
 * measured floor with an instrument path behind it, and the surf zone has no
 * measured fact at all.
 */
export const STATE_PRESENTATION = presentationFor(SURF_STATES, {
  veto: { label: 'Too big', spoken: 'vetoed on swell', glyph: '✕', usable: false },
  'out-of-band': {
    // "Out of band", not "wrong tide". The cell prints the day's turns next to
    // the band it is being judged against, so a reader can see for themselves
    // which side of it the tide sat on; what the state adds is that it never
    // got inside.
    label: 'Out of band',
    spoken: 'out of the tide band',
    glyph: '≠',
    usable: false,
  },
});
