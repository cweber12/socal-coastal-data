/**
 * The first zone module, and the properties the whole three-way membership
 * rests on.
 *
 * These are assertions about the JOIN and the BUCKETS, not about any particular
 * floor. A test that pinned Cabrillo at 1.0 ft would fail the day someone
 * finally measures that bench, which is the outcome this repo is working
 * towards -- so nothing here asserts a value that a legitimate measurement
 * would change. What it asserts is that no spot can go missing, no spot can be
 * in two places at once, and no exclusion can arrive without its reason.
 */

import { describe, expect, it } from 'vitest';

import {
  INTERTIDAL_DATUM,
  INTERTIDAL_FLOOR_UNITS,
  INTERTIDAL_SPOTS,
  SPOTS_OUTSIDE_INTERTIDAL,
  intertidalMembershipOf,
  intertidalSpotBySlug,
  isIntertidalMember,
} from './intertidal';
import { SPOTS } from '@/shared/spots.generated';

describe('the file this module reads', () => {
  it('is in the datum and units the window predicate compares against', () => {
    // The module throws on load otherwise. Asserted so the guard is visible as a
    // property rather than only as a line of code nobody exercises -- a floor on
    // another datum shifts every verdict by the offset between the two, with
    // nothing in the output looking wrong.
    expect(INTERTIDAL_DATUM).toBe('MLLW');
    expect(INTERTIDAL_FLOOR_UNITS).toBe('ft');
  });
});

describe('membership', () => {
  it('accounts for every spot exactly once', () => {
    /*
     * The property the three buckets exist for. A spot in NO bucket is one this
     * zone silently omits, which is the failure ADR 0003 is about; a spot in two
     * is the file contradicting itself about whether a reef is there. The module
     * throws on load in the first case, so reaching this assertion at all is
     * half the result.
     */
    const covered = [
      ...INTERTIDAL_SPOTS.map((s) => s.slug),
      ...SPOTS_OUTSIDE_INTERTIDAL.map((n) => n.spot.slug),
    ];
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(SPOTS.map((s) => s.slug).sort());
  });

  it('states not_in_zone and unresolved as different things, each with a reason', () => {
    // A harbor entrance and an unsurveyed cobble reef are different answers, and
    // no value of a floor distinguishes them. The reason is what a reader is
    // shown from #126 onward, so an empty one is the bare null this replaced.
    const buckets = new Set(SPOTS_OUTSIDE_INTERTIDAL.map((n) => n.membership));
    expect(buckets).toEqual(new Set(['not_in_zone', 'unresolved']));
    for (const nonMember of SPOTS_OUTSIDE_INTERTIDAL) {
      expect(nonMember.reason.length).toBeGreaterThan(20);
    }
  });

  it('answers for every real spot and refuses an unknown slug', () => {
    for (const spot of SPOTS) {
      expect(intertidalMembershipOf(spot.slug)).not.toBeNull();
    }
    expect(intertidalMembershipOf('not-a-spot')).toBeNull();
    expect(intertidalMembershipOf('')).toBeNull();
  });

  it('does not answer for Object.prototype keys', () => {
    // The slug reaches this from a URL segment. shared/spots.generated.ts
    // documents what an inherited `constructor` cost the first time: a 500 where
    // a 404 belongs.
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(intertidalMembershipOf(key)).toBeNull();
      expect(intertidalSpotBySlug(key)).toBeNull();
    }
  });
});

describe('a member', () => {
  it('carries the zone facts joined to its inventory record', () => {
    for (const spot of INTERTIDAL_SPOTS) {
      // Zone side.
      expect(spot.floorFt).toBeTypeOf('number');
      expect(['low', 'verified']).toContain(spot.floorConfidence);
      expect(spot.floorEvidence.length).toBeGreaterThan(0);
      // Inventory side. A half-joined member would still have looked fine to a
      // renderer reading only the floor.
      expect(spot.name.length).toBeGreaterThan(0);
      expect(spot.tide_station).toBeTypeOf('string');
      expect(spot.lat).toBeTypeOf('number');
      expect(spot.lon).toBeLessThan(0);
      expect(isIntertidalMember(spot)).toBe(true);
    }
  });

  it('carries an unbroken ledger behind the floor in force', () => {
    /*
     * floor_ft is the value in force, NOT the newest entry -- three of the eight
     * are ceilings from a permissiveness rule and two of those are the
     * conservative end of a bracket, so the newest entry is deliberately not the
     * answer. What must hold is that every entry says which method ran and what
     * it established, including the ones that ran and produced nothing: a null
     * value_ft with no note makes "has not run" indistinguishable from "ran and
     * found nothing usable".
     */
    for (const spot of INTERTIDAL_SPOTS) {
      for (const entry of spot.floorEvidence) {
        expect(entry.method.length).toBeGreaterThan(0);
        expect(entry.note.length).toBeGreaterThan(20);
        expect(entry.source.length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves by slug, and a non-member never does', () => {
    for (const spot of INTERTIDAL_SPOTS) {
      expect(intertidalSpotBySlug(spot.slug)?.slug).toBe(spot.slug);
    }
    for (const nonMember of SPOTS_OUTSIDE_INTERTIDAL) {
      // Both buckets refuse identically. Saying WHY they refuse is
      // intertidalMembershipOf's job, and #126's.
      expect(intertidalSpotBySlug(nonMember.spot.slug)).toBeNull();
      expect(isIntertidalMember(nonMember.spot)).toBe(false);
    }
  });
});

describe('corridor order', () => {
  it('is the inventory\'s order, in both lists', () => {
    /*
     * spots.json is ordered north to south and everything corridor-ordered in
     * this repo inherits that by preserving it -- the grid's geographic sort
     * returns rows untouched because the order arrives correct. Both lists are
     * built by walking SPOTS for exactly this reason; walking the zone file
     * instead would make the page's order depend on the order someone happened
     * to append a bucket entry in.
     */
    const inventoryIndex = new Map<string, number>(SPOTS.map((s, i) => [s.slug, i]));
    const ascending = (slugs: string[]) =>
      slugs.every((slug, i) => i === 0 || inventoryIndex.get(slugs[i - 1]!)! < inventoryIndex.get(slug)!);

    expect(ascending(INTERTIDAL_SPOTS.map((s) => s.slug))).toBe(true);
    expect(ascending(SPOTS_OUTSIDE_INTERTIDAL.map((n) => n.spot.slug))).toBe(true);
  });
});
