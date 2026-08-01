/**
 * The shape every activity produces for one spot on one local day.
 *
 * `{ windows[], state, reason, disclosures, detail }`, per PRD #101 decision 2,
 * plus the facts about the day that every occupant needs and none of them owns:
 * where the sun was, and what the buoy said.
 *
 * ===========================================================================
 * What left this type, and why
 * ===========================================================================
 *
 * Tidepool's `WindowResult` used to name `lowFt`, `nextHighMs`, `reachesFloor`
 * and `floorFt` at the top level. That made the SHARED shape assert that every
 * activity is anchored on a low and judged against a floor, which is false of
 * the second occupant and would have been false of the third: a surf day has no
 * single anchor at all — one session can hold a high and a low while the next
 * holds no turn — and its predicate is a band, not a floor.
 *
 * So the four moved into an activity-typed `detail`, which is where anything
 * only one activity can answer belongs. `detail` is where the SELECTION lives
 * too: "which window is this day about" is the activity's judgement, and the two
 * occupants already disagree about it.
 *
 *   tidepool  today: the next low whose window has not shut. Other days: the
 *             best daylight low.
 *   surf      most decisive minutes, then most usable minutes, then earliest.
 *
 * Neither is more correct; they answer different questions. A shared field
 * called `best` would have had to pick one of those meanings and impose it.
 */

import type { LocalDate } from '../time';
import type { TideExtremum } from '../feeds/coops-predictions';

/**
 * One window of a day, after the gates have had their say.
 *
 * The solver's interval plus the daylight and operator-gate clips. Both the raw
 * span and the clipped one are kept, and measured separately, so a cell can say
 * "1 h 36 min window, 42 min left" rather than conflating the two.
 */
export interface UsableWindow {
  /**
   * The window as the activity's predicate defines it for this day, BEFORE the
   * daylight and gate clips.
   *
   * Whether it is clipped to the local day is the activity's business and the
   * two differ: surf clips, because a band run genuinely crosses midnight and
   * `continuesBefore` is how the cell says so; tidepool does not, because its
   * window is derived from a low inside the day and its flood-side trim already
   * bounds it.
   */
  startMs: number;
  endMs: number;

  /** True when this window was already under way when the local day began. */
  continuesBefore: boolean;
  /** True when it had not ended when the local day did. */
  continuesAfter: boolean;
  /**
   * True when the window ran past either end of the prediction series, so its
   * reported length is a floor on the real one rather than the real one.
   */
  seriesClipped: boolean;

  /**
   * The turning points inside this window, in time order. Zero, one or two.
   * Reported by the solver, never supplied to it — see solve.ts.
   */
  anchors: TideExtremum[];

  /** The window after clipping to daylight and then to the operator gate. */
  usableStartMs: number;
  usableEndMs: number;
  usableMinutes: number;

  /** Usable minutes still ahead of `now`, for today only; null on other days. */
  minutesRemaining: number | null;

  /** True when there was daylight to use and the operator gate is what took it. */
  gateBlocked: boolean;
}

export interface ActivityDay<State extends string, Detail> {
  state: State;
  date: LocalDate;
  /** True when `date` is the local day `now` falls on. */
  isToday: boolean;
  /** Whole local days from today to `date`. Negative for the past. */
  daysFromToday: number;

  /**
   * Every window of this local day, in time order.
   *
   * Note this is the DAY's windows, not the one the verdict is about. Which one
   * that is — if any — is in `detail`, because choosing is a judgement. An
   * activity whose predicate produced nothing has an empty array here, which is
   * the state its own predicate emits: `above-floor`, `out-of-band`.
   */
  windows: UsableWindow[];

  sunriseMs: number;
  sunsetMs: number;

  /** Swell as it was applied. `swellKnown` false means unknown, never calm. */
  swellFt: number | null;
  swellKnown: boolean;
  swellCeilingFt: number;
  /** Null where the activity reads swell as a hazard only. See gates.ts. */
  swellMinimumFt: number | null;

  /**
   * One sentence on why this state, for disclosure in the UI.
   *
   * Includes every entry of `disclosures`, appended in order. The reason is what
   * a reader is shown and it has to stand alone; `disclosures` is the same
   * caveats as data, for anything that wants to render them separately.
   */
  reason: string;

  /**
   * Caveats about this day's numbers, as sentences.
   *
   * Empty on an ordinary day. Today's only member is the series-clipped note —
   * the window ran past the end of the predictions, so its length is a minimum
   * rather than a measurement.
   */
  disclosures: readonly string[];

  /** Everything only this activity can answer. */
  detail: Detail;
}
