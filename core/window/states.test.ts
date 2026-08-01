import { describe, expect, it } from 'vitest';

import {
  CORE_STATES,
  CORE_STATE_PRESENTATION,
  coreStatesIn,
  presentationFor,
  type CoreState,
} from './states';

/* =========================================================================
 * The orderings, which are decisions rather than defaults
 * ======================================================================= */

const at = (state: CoreState) => CORE_STATES.indexOf(state);

describe('precedence', () => {
  it('has every gate state exactly once', () => {
    expect(CORE_STATES).toHaveLength(7);
    expect(new Set(CORE_STATES).size).toBe(7);
  });

  it('sorts closed above dark, because a shut gate is decisive whatever the light', () => {
    // NPS scopes its own Cabrillo threshold by park hours -- the
    // Superintendent's Compendium binds at low tides "0.7 or lower during park
    // hours". `dark` still fires whenever the daylight clip is what emptied the
    // window, so the two causes are never conflated.
    expect(at('closed')).toBeLessThan(at('dark'));
  });

  it('sorts brief below veto and below flat', () => {
    // A swell answer is settled, and there is no point qualifying a settled no
    // with how long it would have been.
    expect(at('brief')).toBeGreaterThan(at('veto'));
    expect(at('brief')).toBeGreaterThan(at('flat'));
  });

  it('sorts swell-tbd above go, which is the repo-wide invariant', () => {
    // An unknown can never render as a pass. This is the one ordering here that
    // is not a window rule -- it is the rule the whole stack is built on.
    expect(at('swell-tbd')).toBeLessThan(at('go'));
  });

  it('sorts swell-tbd below brief', () => {
    // A 20-minute window is a settled fact about the tide and should be reported
    // as such rather than deferred to an unknown.
    expect(at('swell-tbd')).toBeGreaterThan(at('brief'));
  });

  it('sorts veto above flat, because a hazard outranks an absence', () => {
    expect(at('veto')).toBeLessThan(at('flat'));
  });
});

describe('coreStatesIn', () => {
  it('picks the gate states out of an activity’s list, in that list’s order', () => {
    expect(coreStatesIn(['above-floor', 'closed', 'dark', 'go'])).toEqual([
      'closed',
      'dark',
      'go',
    ]);
  });

  it('reports a reordering rather than tolerating it', () => {
    // How an activity's own suite checks it did not quietly move `go` above
    // `swell-tbd` while inserting its predicate state at the front.
    expect(coreStatesIn(['out-of-band', 'go', 'swell-tbd'])).toEqual(['go', 'swell-tbd']);
    expect(coreStatesIn(['out-of-band', 'go', 'swell-tbd'])).not.toEqual(
      CORE_STATES.filter((s) => s === 'go' || s === 'swell-tbd'),
    );
  });
});

/* =========================================================================
 * Presentation
 * ======================================================================= */

describe('CORE_STATE_PRESENTATION', () => {
  it('has a row for every gate state and nothing else', () => {
    expect(Object.keys(CORE_STATE_PRESENTATION).sort()).toEqual([...CORE_STATES].sort());
  });

  it('carries a word, a spoken form and a glyph on every row', () => {
    for (const state of CORE_STATES) {
      const row = CORE_STATE_PRESENTATION[state];
      // Colour is never the only channel, and since #123 it is not a channel at
      // all: a coloured verdict asserts a confidence these predicates lack.
      expect(row.label.length, state).toBeGreaterThan(0);
      expect(row.spoken.length, state).toBeGreaterThan(0);
      expect(row.glyph.length, state).toBeGreaterThan(0);
    }
  });

  it('never uses a tide arrow as a glyph', () => {
    // A cell prints ▼ against its low and ▲ against its high, so a state glyph
    // colliding with either reads as a second, contradictory tide marker.
    for (const state of CORE_STATES) {
      expect(CORE_STATE_PRESENTATION[state].glyph, state).not.toBe('▲');
      expect(CORE_STATE_PRESENTATION[state].glyph, state).not.toBe('▼');
    }
  });

  it('counts only go as usable', () => {
    expect(CORE_STATES.filter((s) => CORE_STATE_PRESENTATION[s].usable)).toEqual(['go']);
  });

  it('gives go and flat the filled and hollow forms of one shape', () => {
    // The page's only two swell verdicts that are not warnings. "Something
    // there" against "nothing there" is what the contrast should say.
    expect(CORE_STATE_PRESENTATION.go.glyph).toBe('●');
    expect(CORE_STATE_PRESENTATION.flat.glyph).toBe('○');
  });
});

describe('presentationFor', () => {
  const OWN = { label: 'Own', spoken: 'its own', glyph: '≈', usable: false };

  it('has exactly the declared keys, in nothing but the declared order', () => {
    const table = presentationFor(['dark', 'go', 'mine'] as const, { mine: OWN });
    expect(Object.keys(table)).toEqual(['dark', 'go', 'mine']);
  });

  it('takes the core wording for a gate state and the override for anything else', () => {
    const table = presentationFor(['dark', 'mine'] as const, { mine: OWN });
    expect(table.dark).toBe(CORE_STATE_PRESENTATION.dark);
    expect(table.mine).toBe(OWN);
  });

  it('lets an activity override a gate state’s wording', () => {
    // Surf does this to `veto`: over the ceiling is a hazard on a reef and a
    // size call in the water, and "Too big" is what a surfer reads.
    const table = presentationFor(['veto'] as const, {
      veto: { label: 'Too big', spoken: 'vetoed on swell', glyph: '✕', usable: false },
    });
    expect(table.veto.label).toBe('Too big');
  });

  it('refuses a state its own predicate emits with no wording for it', () => {
    // A hard error rather than an undefined lookup at render time.
    expect(() => presentationFor(['dark', 'mine'] as const)).toThrow(/no presentation/);
  });

  it('refuses an override nothing can reach', () => {
    // A presentation for a state the activity does not list is a rule nobody can
    // tell has stopped being load-bearing.
    expect(() => presentationFor(['dark'] as const, { mine: OWN } as never)).toThrow(
      /does not list/,
    );
  });

  it('refuses a duplicated state', () => {
    expect(() => presentationFor(['dark', 'dark'] as const)).toThrow(/duplicate/);
  });
});
