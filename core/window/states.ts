/**
 * The states the gates emit, and how each one is presented.
 *
 * Gates own their states, per PRD #101 decision 4. Every activity that reads a
 * tide, a clock and a buoy needs all of these; what differs between activities
 * is the state their own HEIGHT PREDICATE emits — `above-floor` is tidepool's,
 * `out-of-band` is surf's — and those live in the activity, next to the
 * predicate that produces them.
 *
 *   State = CoreState | ActivityState
 *
 * Nothing here depends on a result type, deliberately. The dependency runs one
 * way: a policy imports these states, never the reverse.
 *
 * ===========================================================================
 * The orderings are load-bearing
 * ===========================================================================
 *
 * `CORE_STATES` is precedence order, most certain first, and three of the
 * relationships in it are decisions rather than defaults. They survived the
 * extraction unchanged and `states.test.ts` says so.
 *
 *   `closed` ABOVE `dark`, because a shut gate is decisive whatever the light,
 *   and because NPS scopes its own Cabrillo threshold by park hours — the
 *   Superintendent's Compendium binds at low tides "0.7 or lower during park
 *   hours". The two rarely conflict in practice: the case this exists for is a
 *   summer 6 a.m. low, which is broad daylight and gated. `dark` still fires
 *   whenever the daylight clip is what emptied the window, so the two causes are
 *   never conflated — see `gateBlocked` in gates.ts.
 *
 *   `brief` BELOW `veto` and `flat`, because a swell answer is settled and there
 *   is no point qualifying a settled no with how long it would have been.
 *
 *   `swell-tbd` ABOVE `go`, because an unknown may never render as a pass. That
 *   one is the repo-wide invariant, not a window rule. It sits BELOW `brief`
 *   because a 20-minute window is a settled fact about the tide and should be
 *   reported as such rather than deferred to an unknown.
 *
 * `veto` sits above `flat` only because a hazard outranks an absence when both
 * could somehow be true. They are mutually exclusive while the minimum is below
 * the ceiling, which is asserted where the two are read.
 */

/**
 * The seven gate states, in the order they are tested.
 *
 *   closed     Every window falls outside the operator's gate hours.
 *   dark       Every window falls outside the available daylight.
 *   veto       A known swell reading is over the ceiling.
 *   flat       A known swell reading is under the minimum.
 *   brief      There are windows, but none reaches the minimum duration.
 *   swell-tbd  Everything else clears, but the swell is unknown.
 *   go         Clears everything.
 *
 * An activity emits only the ones its gates can produce. `flat` is emitted only
 * where a swell MINIMUM is declared: an activity that reads swell as a hazard
 * only — tidepool — passes none and can never reach it, which is why tidepool's
 * own list is six of these plus its predicate state rather than all seven.
 */
export type CoreState = 'closed' | 'dark' | 'veto' | 'flat' | 'brief' | 'swell-tbd' | 'go';

export const CORE_STATES: readonly CoreState[] = [
  'closed',
  'dark',
  'veto',
  'flat',
  'brief',
  'swell-tbd',
  'go',
];

/* ===========================================================================
 * Presentation, kept next to the states it describes
 * ========================================================================= */

export interface StatePresentation {
  /** Short label, shown where the state is disclosed rather than on a cell face. */
  label: string;
  /** Word used in the aria-label sentence. */
  spoken: string;
  /**
   * Glyph. It is not a substitute for the word — both are always shown together
   * — it is a second channel so the label is recognisable at a glance.
   *
   * None of these may be `▲` or `▼`. Those two are the tide arrows a cell puts
   * against the turns it prints, and a state glyph that collides with one reads
   * as a second, contradictory tide reading in the same cell. Asserted in every
   * activity's own suite, because an activity adds glyphs of its own.
   *
   * `go` and `flat` are deliberately the filled and hollow forms of one shape.
   * They are the only two swell verdicts that are not warnings, and "something
   * there" against "nothing there" is what the contrast should say.
   */
  glyph: string;
  /** Whether this state means "you could go". */
  usable: boolean;
}

/**
 * How each gate state is worded, unless an activity says otherwise.
 *
 * No colour, and that is a decision both occupants arrived at independently. The
 * states used to carry one each, painted across the whole cell, and on an
 * ordinary week that produced 56 coloured verdicts from predicates resting on
 * uncalibrated numbers — a floor nobody has field-checked, a swell ceiling that
 * is a corridor-wide guess, a tide band with no measured fact behind it at all.
 * The colour asserted a confidence the maths does not have. Until the thresholds
 * are calibrated the state is secondary information: it lives behind a badge, in
 * words.
 */
export const CORE_STATE_PRESENTATION: Readonly<Record<CoreState, StatePresentation>> = {
  go: { label: 'Go', spoken: 'go', glyph: '●', usable: true },
  brief: { label: 'Brief', spoken: 'brief', glyph: '◐', usable: false },
  // Tidepool's wording. Surf overrides the label -- "Too big" is what a surfer
  // reads off a ceiling, and "Swell" is what a tidepooler reads off a hazard.
  veto: { label: 'Swell', spoken: 'vetoed on swell', glyph: '✕', usable: false },
  flat: { label: 'Flat', spoken: 'flat', glyph: '○', usable: false },
  closed: { label: 'Gate shut', spoken: 'outside gate hours', glyph: '⛔', usable: false },
  dark: { label: 'No light', spoken: 'outside daylight', glyph: '☾', usable: false },
  'swell-tbd': { label: 'Swell TBD', spoken: 'swell unknown', glyph: '?', usable: false },
};

/**
 * Assemble one activity's presentation table from its declared state order.
 *
 * Every state in `order` gets a row: the core one, or the activity's override.
 * A state with neither is a hard error rather than an undefined lookup at render
 * time, and an override for a state the activity does not list is a hard error
 * too — a presentation nothing can reach is a rule nobody can tell has stopped
 * being load-bearing, which is the same failure the boundary checker's stale
 * TEMPORARY entries exist to catch.
 *
 * The returned table has exactly the declared keys, so
 * `Object.keys(table) === order` is a property an activity's suite can assert
 * rather than a convention it has to maintain.
 */
export function presentationFor<S extends string>(
  order: readonly S[],
  overrides: Partial<Record<S, StatePresentation>> = {},
): Readonly<Record<S, StatePresentation>> {
  const seen = new Set<string>(order);
  if (seen.size !== order.length) {
    throw new Error(`presentationFor: duplicate states in ${JSON.stringify(order)}`);
  }

  for (const key of Object.keys(overrides)) {
    if (!seen.has(key)) {
      throw new Error(
        `presentationFor: an override for ${JSON.stringify(key)}, which this activity does not ` +
          'list. A presentation nothing can reach is a rule nobody can tell is still load-bearing.',
      );
    }
  }

  const table = {} as Record<S, StatePresentation>;
  for (const state of order) {
    const row =
      overrides[state] ?? CORE_STATE_PRESENTATION[state as unknown as CoreState] ?? null;
    if (row === null) {
      throw new Error(
        `presentationFor: ${JSON.stringify(state)} is not a gate state and this activity gave it ` +
          'no presentation. A state its own predicate emits has to say how it is worded.',
      );
    }
    table[state] = row;
  }
  return table;
}

/**
 * The gate states in `order`, in the order they appear there.
 *
 * How an activity's suite checks that its own list did not quietly reorder the
 * shared precedence while inserting its predicate state into it.
 */
export function coreStatesIn(order: readonly string[]): CoreState[] {
  const core = new Set<string>(CORE_STATES);
  return order.filter((s): s is CoreState => core.has(s));
}

/**
 * Whether a window falls in daylight, for a cell's background.
 *
 * Deliberately the plainest fact available, and deliberately NOT the `dark`
 * state. `dark` is a verdict about a whole day — a low at 5:30 pm can be in
 * daylight while the usable part of its window is not, and a surf day can carry
 * one session in the light and one after sunset. Verdicts are exactly what the
 * background stopped carrying.
 *
 * Sunrise and sunset are computed to about 30 s, so anything within a minute of
 * either edge could be shaded the other way. Nothing is decided on this: it is a
 * background, and the times themselves are printed next to it.
 */
export type CellLighting = 'day' | 'night';
