import { describe, expect, it } from 'vitest';

import {
  isSurfZoneMember,
  SPOTS_OUTSIDE_SURF,
  SURF_ACCOUNTING,
  SURF_SPOTS,
  SURF_ZONE_UNRESOLVED,
  surfMembershipOf,
  surfSpotBySlug,
} from './surf';
import { SPOTS } from '@/shared/spots.generated';

describe('surf zone membership', () => {
  it('accounts for every spot in the inventory exactly once', () => {
    /*
     * The invariant ADR 0003 exists for: no null carries two meanings, and no
     * spot falls down the gap between the grid and the disclosure. The
     * intertidal enforces this by throwing on load for a spot in no bucket;
     * here it holds by construction, because the loop puts every spot in one of
     * two. Asserted anyway -- "it is true by construction" is exactly the claim
     * that stops being true when somebody adds a third branch.
     */
    const { members, notInZone, unresolved, inventory } = SURF_ACCOUNTING;
    expect(members + notInZone + unresolved).toBe(inventory);
    expect(inventory).toBe(SPOTS.length);

    const named = new Set([
      ...SURF_SPOTS.map((s) => s.slug),
      ...SPOTS_OUTSIDE_SURF.map((n) => n.spot.slug),
    ]);
    expect(named.size).toBe(SPOTS.length);
  });

  it('is the two lagoons that are out, and only them', () => {
    // Batiquitos and San Elijo are the only spots in shared/spots.json whose
    // wave binding is null in both slots. Named rather than counted, because a
    // count would pass if the set changed and stayed the same size.
    expect(SPOTS_OUTSIDE_SURF.map((n) => n.spot.slug)).toEqual([
      'batiquitos-lagoon',
      'san-elijo-lagoon',
    ]);
  });

  it('calls the two lagoons not_in_zone, never unresolved', () => {
    /*
     * The distinction that made three buckets necessary. `unresolved` would say
     * somebody has yet to get around to measuring the surf in a lagoon;
     * `not_in_zone` says there is nothing there to measure. shared/spots.json
     * carries a deliberate null, not an empty field.
     */
    for (const nonMember of SPOTS_OUTSIDE_SURF) {
      expect(nonMember.membership).toBe('not_in_zone');
      expect(nonMember.reason).toMatch(/binds no wave buoy/);
    }
    expect(SURF_ACCOUNTING.unresolved).toBe(0);
  });

  it('every member carries the buoy that put it in the zone', () => {
    for (const spot of SURF_SPOTS) {
      expect(spot.boundBuoyId).toBeTruthy();
      expect(spot.boundBuoyId).toBe(spot.wave.primary ?? spot.wave.fallback);
    }
  });

  it('holds corridor order, north to south, without re-deriving it', () => {
    // spots.json is ordered Oceanside Harbour to Border Field and the module
    // walks SPOTS rather than a membership list, so the grid's geographic sort
    // can return rows untouched.
    const inventoryOrder = SPOTS.map((s) => s.slug);
    const memberOrder = SURF_SPOTS.map((s) => s.slug);
    expect(memberOrder).toEqual(inventoryOrder.filter((slug) => memberOrder.includes(slug)));
  });

  it('includes the two spots that carry a per-spot ceiling', () => {
    // activities/surf/thresholds.json holds overrides for blacks-beach and
    // tourmaline. An override on a spot outside the zone would be a judgement
    // about a place this activity never renders -- which is exactly the state
    // #128 left them in and #129 is meant to end.
    expect(surfSpotBySlug('blacks-beach')).not.toBeNull();
    expect(surfSpotBySlug('tourmaline')).not.toBeNull();
  });

  it('includes the three spots the deleted audiences tag left out', () => {
    /*
     * The check on the decision itself. `audiences: surf` was 18 spots and
     * excluded Torrey Pines State Beach, La Jolla Shores and Silver Strand --
     * open coast on any reading, and each bound to a buoy. That tag answered
     * "would a surfer pick this?", which is an activity's question and was a
     * hand-made answer to it. Membership derived from the binding does not
     * inherit that judgement, and this is where a future attempt to restore the
     * old set would fail.
     */
    for (const slug of ['torrey-pines-beach', 'la-jolla-shores', 'silver-strand']) {
      expect(surfSpotBySlug(slug), slug).not.toBeNull();
    }
    expect(SURF_ACCOUNTING.members).toBe(24);
  });
});

describe('resolving a slug', () => {
  it('returns null for an unknown slug rather than guessing', () => {
    expect(surfSpotBySlug('not-a-spot')).toBeNull();
    expect(surfMembershipOf('not-a-spot')).toBeNull();
  });

  it('does not spring the Object.prototype trap on a route segment', () => {
    // A slug arrives from a URL and is untrusted. This looks in an array, so
    // `constructor` and `__proto__` are misses like anything else.
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(surfSpotBySlug(hostile), hostile).toBeNull();
      expect(surfMembershipOf(hostile), hostile).toBeNull();
    }
  });

  it('distinguishes a non-member from a non-spot', () => {
    // Null means "not in the inventory" and is a 404. A non-member is a real
    // place with a real reason, and the page owes the reader that reason.
    const lagoon = surfMembershipOf('batiquitos-lagoon');
    expect(lagoon).not.toBeNull();
    expect(lagoon!.membership).toBe('not_in_zone');
    expect(surfSpotBySlug('batiquitos-lagoon')).toBeNull();
  });

  it('agrees with isSurfZoneMember for every spot in the inventory', () => {
    for (const spot of SPOTS) {
      expect(isSurfZoneMember(spot), spot.slug).toBe(surfSpotBySlug(spot.slug) !== null);
    }
  });
});

describe('what this zone discloses', () => {
  it('says out loud that membership is not a claim about surf breaks', () => {
    /*
     * The load-bearing sentence. The whole derivation rests on it: a buoy
     * binding says this stack can read a wave height, and nothing more. If this
     * disclosure is ever dropped, the grid starts making a claim the data does
     * not support and nothing else on the page would say so.
     */
    const joined = SURF_ZONE_UNRESOLVED.join(' ');
    expect(joined).toMatch(/NOT "THIS IS A SURF BREAK"/);
    expect(joined).toMatch(/Oceanside Harbor/);
  });

  it('says the zone holds no measured fact', () => {
    expect(SURF_ZONE_UNRESOLVED.join(' ')).toMatch(/NO MEASURED FACT/);
  });

  it('carries the caveat a surf reader is most likely to act on', () => {
    // The one ADR 0008 calls the loudest unstated caveat in the repo: buoy
    // significant wave height is not breaking height at the break.
    expect(SURF_ZONE_UNRESOLVED.join(' ')).toMatch(
      /SIGNIFICANT WAVE HEIGHT AT THE BUOY IS NOT BREAKING HEIGHT AT THE BREAK/,
    );
  });

  it('is non-empty and every entry is a full sentence', () => {
    expect(SURF_ZONE_UNRESOLVED.length).toBeGreaterThan(0);
    for (const entry of SURF_ZONE_UNRESOLVED) {
      expect(entry.length).toBeGreaterThan(80);
      expect(entry.trimEnd().endsWith('.')).toBe(true);
    }
  });
});
