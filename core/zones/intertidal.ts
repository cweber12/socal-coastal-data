/**
 * The intertidal zone: which spots have one, and where each reef surfaces.
 *
 * Activity-neutral, and that is the whole point of the module existing. The
 * floor is the tide height at which a bench comes out of the water -- the same
 * number for a photographer, a MARINe surveyor and a child with a bucket. It is
 * not a tidepool parameter, nothing under activities/ owns it, and an activity
 * that wants it composes this zone rather than holding the number itself. See
 * docs/adr/0001-zones-own-facts-activities-own-verdicts.md.
 *
 * ---------------------------------------------------------------------------
 * Two files, one join, on slug
 * ---------------------------------------------------------------------------
 *
 * shared/spots.json holds bindings and joins -- where a spot is, which buoy and
 * station it reads. shared/intertidal.json holds this zone's measured facts and
 * its membership. They are joined here, on slug, and nowhere else. This file
 * deliberately carries no coordinate, name or station of its own: a second copy
 * of a coordinate is a second thing to keep in step.
 *
 * The join is total in both directions and throws when it is not. A member slug
 * with no spot is a floor for a place that does not exist; a spot in no bucket
 * is a spot this zone cannot answer for at all, which is the failure the
 * three-way membership was introduced to end, one layer down from where it
 * shows up on a page. scripts/gen-intertidal-types.mjs checks the same two
 * things against the files; this checks them against what actually loaded.
 *
 * ---------------------------------------------------------------------------
 * Membership is three-way, and a null never stands for two things
 * ---------------------------------------------------------------------------
 *
 *   member       the spot has this zone, and here are its facts
 *   not_in_zone  the spot does not have this zone, with the reason
 *   unresolved   membership or facts unmeasured, with the reason
 *
 * A harbor entrance and an unsurveyed cobble reef are different answers, and no
 * value of a floor distinguishes them. See
 * docs/adr/0003-zone-membership-is-three-way.md, and #126 for the render.
 */

import {
  INTERTIDAL_DATUM,
  INTERTIDAL_FLOOR_UNITS,
  INTERTIDAL_GENERATED,
  INTERTIDAL_MEMBERS,
  INTERTIDAL_NOT_IN_ZONE,
  INTERTIDAL_UNRESOLVED,
  INTERTIDAL_VERSION,
  type FloorConfidence,
  type FloorEvidence,
  type IntertidalMember,
  type IntertidalMemberSlug,
} from '@/shared/intertidal.generated';
import { SPOTS, SPOT_BY_SLUG, type Spot, type SpotSlug } from '@/shared/spots.generated';

export {
  INTERTIDAL_DATUM,
  INTERTIDAL_FLOOR_UNITS,
  INTERTIDAL_GENERATED,
  INTERTIDAL_VERSION,
};
export type { FloorConfidence, FloorEvidence, IntertidalMember, IntertidalMemberSlug };

/*
 * Asserted on load rather than trusted, and asserted here as well as in the
 * generator, because this is the module that hands the number to a predicate.
 *
 * A floor is compared against CO-OPS predictions fetched in MLLW feet. A file on
 * another datum would shift every floor by the offset between the two, in
 * whichever direction that offset runs, with nothing in the output looking
 * wrong. shared/calibration.json carries the same guard for the same reason.
 */
if (INTERTIDAL_DATUM !== 'MLLW') {
  throw new Error(
    `shared/intertidal.json declares datum ${JSON.stringify(INTERTIDAL_DATUM)}; every floor here is ` +
      'compared against MLLW predictions and nothing in this stack converts between datums.',
  );
}
if (INTERTIDAL_FLOOR_UNITS !== 'ft') {
  throw new Error(
    `shared/intertidal.json declares floor_units ${JSON.stringify(INTERTIDAL_FLOOR_UNITS)}; the ` +
      'predicate, the labels and the chart are all in feet.',
  );
}

/**
 * A spot that is a member of this zone, with the zone's facts attached.
 *
 * `floorFt` is the value IN FORCE. It is not the newest ledger entry and not an
 * average of them: a human sets it against the ledger, three of the eight are
 * ceilings from a permissiveness rule rather than estimates of where the bench
 * is, and every one of them is `floorConfidence: 'low'`.
 */
export type IntertidalSpot = Spot & {
  slug: IntertidalMemberSlug;
  floorFt: number;
  floorConfidence: FloorConfidence;
  /** Append-only, oldest first. The whole provenance of `floorFt`. */
  floorEvidence: readonly FloorEvidence[];
};

/** Where a spot stands with this zone. Exactly one of these, always. */
export type IntertidalMembership =
  | { membership: 'member'; spot: IntertidalSpot }
  | { membership: 'not_in_zone'; spot: Spot; reason: string }
  | { membership: 'unresolved'; spot: Spot; reason: string };

/** A spot this zone excludes, and the reason, rendered verbatim. */
export interface IntertidalNonMember {
  spot: Spot;
  membership: 'not_in_zone' | 'unresolved';
  reason: string;
}

const MEMBER_BY_SLUG = new Map(INTERTIDAL_MEMBERS.map((m) => [m.slug as string, m]));
const NOT_IN_ZONE_BY_SLUG = new Map(INTERTIDAL_NOT_IN_ZONE.map((e) => [e.slug as string, e.reason]));
const UNRESOLVED_BY_SLUG = new Map(INTERTIDAL_UNRESOLVED.map((e) => [e.slug as string, e.reason]));

for (const member of INTERTIDAL_MEMBERS) {
  if (!SPOT_BY_SLUG[member.slug as SpotSlug]) {
    throw new Error(
      `shared/intertidal.json holds a floor for '${member.slug}', which is not a slug in ` +
        'shared/spots.json. A floor for a place the inventory does not have is a measurement of nothing.',
    );
  }
}

function attach(spot: Spot, member: IntertidalMember): IntertidalSpot {
  return {
    ...spot,
    slug: member.slug,
    floorFt: member.floor_ft,
    floorConfidence: member.floor_confidence,
    floorEvidence: member.floor_evidence,
  };
}

/*
 * Both lists are built by walking SPOTS, not by walking the zone file.
 *
 * spots.json is ordered north to south, from Oceanside Harbour down to Border
 * Field, and every corridor-ordered thing in this repo inherits that order by
 * preserving it rather than by re-deriving it -- the grid's geographic sort
 * returns rows untouched precisely because this order arrives correct. Walking
 * the zone file instead would make the page's order depend on the order someone
 * happened to append a bucket entry in.
 */
const members: IntertidalSpot[] = [];
const nonMembers: IntertidalNonMember[] = [];

for (const spot of SPOTS) {
  const member = MEMBER_BY_SLUG.get(spot.slug);
  if (member) {
    members.push(attach(spot, member));
    continue;
  }
  const notInZone = NOT_IN_ZONE_BY_SLUG.get(spot.slug);
  if (notInZone !== undefined) {
    nonMembers.push({ spot, membership: 'not_in_zone', reason: notInZone });
    continue;
  }
  const unresolved = UNRESOLVED_BY_SLUG.get(spot.slug);
  if (unresolved !== undefined) {
    nonMembers.push({ spot, membership: 'unresolved', reason: unresolved });
    continue;
  }
  throw new Error(
    `'${spot.slug}' is in no bucket of shared/intertidal.json. Membership is stated three ways so ` +
      'that no null carries two meanings; a spot in none of them is one this zone silently omits.',
  );
}

/** Every member, in corridor order. How many is the file's statement, not this module's. */
export const INTERTIDAL_SPOTS: readonly IntertidalSpot[] = members;

/**
 * Every non-member, in corridor order, whichever bucket it is in.
 *
 * One list rather than two because a caller that wants to name the spots it left
 * out wants them in the order they appear on the coast, and two lists
 * concatenated would put four spots from Oceanside to Coronado ahead of a
 * fourteen-spot run that interleaves with them. Each entry carries which bucket
 * it came from, so a caller that needs the distinction has it without
 * re-deriving it -- which is what #126 renders.
 */
export const SPOTS_OUTSIDE_INTERTIDAL: readonly IntertidalNonMember[] = nonMembers;

/**
 * Resolve a slug to a member, or null.
 *
 * Null for an unknown slug, for a spot in `not_in_zone` and for one in
 * `unresolved` alike. A caller that needs to tell those apart -- to say why
 * rather than that -- calls `intertidalMembershipOf`. Returning null rather than
 * guessing a floor is the reason the grid is eight spots and not twenty-six.
 *
 * The slug arrives from a URL segment, which is untrusted. This looks in an
 * array, and `Map`s elsewhere in this module, so `constructor`, `__proto__` and
 * the rest of Object.prototype's keys are misses like anything else -- the trap
 * shared/spots.generated.ts documents at SPOT_BY_SLUG needs an object literal to
 * spring, and there is none here.
 */
export function intertidalSpotBySlug(slug: string): IntertidalSpot | null {
  return members.find((m) => m.slug === slug) ?? null;
}

/**
 * Where a spot stands with this zone, or null if the slug is not a spot at all.
 *
 * The null is about the INVENTORY, not about this zone: an unknown slug is a
 * 404, and every real spot has an answer here by construction.
 */
export function intertidalMembershipOf(slug: string): IntertidalMembership | null {
  const member = members.find((m) => m.slug === slug);
  if (member) return { membership: 'member', spot: member };
  const nonMember = nonMembers.find((n) => n.spot.slug === slug);
  if (nonMember) {
    return { membership: nonMember.membership, spot: nonMember.spot, reason: nonMember.reason };
  }
  return null;
}

/**
 * Whether a spot is a member of this zone.
 *
 * Deliberately NOT a type predicate. `isTidepoolSpot` was one while the floor
 * was a field on the spot, and it cannot be one now: a `Spot` read from the
 * inventory carries no floor whether or not it is a member, so narrowing it to
 * `IntertidalSpot` would promise fields that are only on the joined object this
 * module builds. Callers that want the facts call `intertidalSpotBySlug`.
 */
export function isIntertidalMember(spot: Spot): boolean {
  return MEMBER_BY_SLUG.has(spot.slug);
}
