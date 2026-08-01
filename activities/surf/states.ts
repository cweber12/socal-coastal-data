/**
 * Surf's states, and how each one is presented.
 *
 * A copy of activities/tidepool/states.ts with two predicate states of its own,
 * and the duplication is deliberate — #130 extracts the shared gate states from
 * two real occupants rather than guessing at the second one's requirements from
 * the first. Do not import tidepool's; scripts/check-boundaries.mjs refuses it
 * structurally, which is the rule working.
 *
 * Nothing here depends on `SurfDay`, on the same terms and for the same reason:
 * the dependency runs one way, policy.ts imports these states, so the lift into
 * core/window/states.ts does not have to untangle a cycle first.
 */

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
 * SIX OF THESE ARE TIDEPOOL'S, WORD FOR WORD, and that is the finding #130 is
 * built on rather than an accident to tidy up. `closed`, `dark`, `veto`,
 * `brief`, `swell-tbd` and `go` are gate states any activity reading a tide, a
 * clock and a buoy would need. What differs is the two this activity's own
 * predicate emits:
 *
 *   `out-of-band` is surf's, and it is the band's analogue of tidepool's
 *   `above-floor`. They are not the same state renamed: `above-floor` has a
 *   direction and this does not. A tide can miss the band by being too low, and
 *   the reason string says which, because "the reef stays covered" has no
 *   equivalent here — a spot can be unusable at dead low and unusable at the top
 *   of the tide on the same day.
 *
 *   `flat` is surf's too, and it is the reason this activity needed a state
 *   tidepool has no use for. Tidepool reads swell as a hazard only: over the
 *   ceiling and you should not be on the reef. Surf reads it in both directions,
 *   because under the minimum there is simply nothing there. Without it, a 0.4 ft
 *   reading with the tide in the band read `go`.
 *
 * Four orderings are deliberate:
 *
 *   `closed` sits ABOVE `dark` because a shut gate is decisive whatever the
 *   light, exactly as it is for tidepool.
 *
 *   `veto` and `flat` sit ABOVE `brief` because a swell answer is settled and
 *   there is no point qualifying a settled no with how long it would have been.
 *
 *   `veto` sits above `flat` only because a hazard outranks an absence when
 *   both could somehow be true. They are mutually exclusive while the minimum is
 *   below the ceiling, which thresholds.ts refuses to load without.
 *
 *   `swell-tbd` sits BELOW `brief` and ABOVE `go`, unchanged from tidepool and
 *   for the repo-wide reason: an unknown may never render as a pass.
 */
export type SurfState =
  | 'out-of-band'
  | 'closed'
  | 'dark'
  | 'veto'
  | 'flat'
  | 'brief'
  | 'swell-tbd'
  | 'go';

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
   * against the turns it prints, and a state glyph that collides with one reads
   * as a second, contradictory tide reading in the same cell.
   *
   * `go` and `flat` are deliberately the filled and hollow forms of one shape.
   * The pair is the page's only two swell verdicts that are not warnings, and
   * "something there" against "nothing there" is what the contrast should say.
   */
  glyph: string;
  /** Whether this state means "you could go". */
  usable: boolean;
}

/**
 * How a state is worded when it is disclosed.
 *
 * No colour, on the same terms tidepool established: a coloured verdict reads as
 * a measurement, and every surf verdict rests on a tide band, a swell ceiling
 * and a swell minimum that are all uncalibrated author estimates. On this page
 * the argument is stronger than it was there — tidepool at least has a measured
 * floor with an instrument path behind it, and the surf zone has no measured
 * fact at all.
 */
export const STATE_PRESENTATION: Readonly<Record<SurfState, StatePresentation>> = {
  go: { label: 'Go', spoken: 'go', glyph: '●', usable: true },
  brief: { label: 'Brief', spoken: 'brief', glyph: '◐', usable: false },
  veto: { label: 'Too big', spoken: 'vetoed on swell', glyph: '✕', usable: false },
  flat: { label: 'Flat', spoken: 'flat', glyph: '○', usable: false },
  closed: { label: 'Gate shut', spoken: 'outside gate hours', glyph: '⛔', usable: false },
  dark: { label: 'No light', spoken: 'outside daylight', glyph: '☾', usable: false },
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
  'swell-tbd': { label: 'Swell TBD', spoken: 'swell unknown', glyph: '?', usable: false },
};

/**
 * Whether a session falls in daylight.
 *
 * The plainest fact available, and deliberately NOT the `dark` state: `dark` is
 * a verdict about a whole day, and a day can have one session in the light and
 * one after sunset. Sunrise and sunset are computed to about 30 s, so a session
 * edge within a minute of either could be shaded the other way. Nothing is
 * decided on this; it is a background, and the times themselves are printed.
 */
export type CellLighting = 'day' | 'night';
