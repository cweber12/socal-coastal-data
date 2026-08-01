/**
 * The surf zone: which spots have one, and nothing else.
 *
 * Activity-neutral, like every zone. Where waves break is the same band for a
 * surfer, a lifeguard and someone deciding whether to swim, so no activity owns
 * it. See docs/adr/0001-zones-own-facts-activities-own-verdicts.md.
 *
 * ---------------------------------------------------------------------------
 * This zone holds MEMBERSHIP AND NO MEASURED FACT, on purpose
 * ---------------------------------------------------------------------------
 *
 * The intertidal has a floor: a height, per spot, produced by this repo's own
 * instruments and carried by an append-only ledger with a path to `verified`.
 * The surf zone has no equivalent and this module does not invent one. PRD #101
 * left that open -- "does the surf zone get a measured zone fact, or only
 * thresholds?" -- and ADR 0008 already leant the same way in its consequences.
 * docs/adr/0014 answers it: membership yes, measured fact no.
 *
 * What that means concretely is that everything an activity needs to JUDGE the
 * surf zone -- a tide band, a swell ceiling, a swell minimum -- is an author
 * estimate and lives in activities/surf/thresholds.json, where its provenance is
 * declared. Nothing here is a threshold and nothing here is uncalibrated,
 * because nothing here is a number.
 *
 * ---------------------------------------------------------------------------
 * Membership is DERIVED, never listed
 * ---------------------------------------------------------------------------
 *
 * shared/intertidal.json states its membership as three explicit buckets,
 * because the facts behind it are measured per spot and somebody had to walk a
 * bench to know. This zone has no such facts, so an explicit list here would be
 * twenty-six hand-typed judgements with nothing checking them -- which is
 * precisely the `audiences` tag #125 deleted, rebuilt under a new name and this
 * time load-bearing for a rendered verdict.
 *
 * The one machine-readable thing the repo actually knows about the surf zone is
 * the wave binding: which buoy shared/spots.json says reports this spot's
 * significant wave height. So that is the predicate, stated once, below. It
 * cannot drift out of step with the file, because it IS the file.
 *
 * ---------------------------------------------------------------------------
 * What this membership does NOT claim
 * ---------------------------------------------------------------------------
 *
 * Not that a member is a surf break. "Bound to a buoy" means this stack can read
 * a wave height for the spot; whether waves there are worth riding is a
 * judgement no upstream in this repo answers. Oceanside Harbor is a member on
 * these terms and is a harbor mouth. That gap is not hidden -- it is the first
 * entry in SURF_ZONE_UNRESOLVED and it is rendered on every page that shows a
 * surf verdict.
 *
 * The deleted `audiences: surf` tag drew a different line: 18 spots, excluding
 * Torrey Pines State Beach, La Jolla Shores and Silver Strand, which are open
 * coast by any reading. That tag answered "would a surfer pick this?", which is
 * an activity's question and a hand-made answer to it. It is not resurrected
 * here.
 */

import {
  SPOTS,
  type BuoyId,
  type Spot,
  type SpotSlug,
} from '@/shared/spots.generated';

/**
 * A spot that is a member of this zone, with the binding that made it one.
 *
 * `boundBuoyId` is the buoy shared/spots.json names for this spot, primary
 * first. It is NOT a promise that the buoy is delivering, and it is not
 * necessarily the buoy a reading comes from: resolveSpotSwell falls back and
 * discloses the substitution, and six spots carry an `intended_primary` that is
 * marked dead. What this field says is which binding put the spot in the zone.
 */
export type SurfSpot = Spot & {
  slug: SpotSlug;
  boundBuoyId: BuoyId;
};

/** Where a spot stands with this zone. Exactly one of these, always. */
export type SurfMembership =
  | { membership: 'member'; spot: SurfSpot }
  | { membership: 'not_in_zone'; spot: Spot; reason: string }
  | { membership: 'unresolved'; spot: Spot; reason: string };

/** A spot this zone excludes, and the reason, rendered verbatim. */
export interface SurfNonMember {
  spot: Spot;
  membership: 'not_in_zone' | 'unresolved';
  reason: string;
}

/**
 * The membership predicate, written once.
 *
 * A spot is in the surf zone when shared/spots.json binds it a wave buoy. Both
 * slots are checked rather than only `primary`, because a spot could be given a
 * fallback alone -- and "there is a buoy that reports waves here" is the claim,
 * not "there is a primary".
 */
function boundBuoyOf(spot: Spot): BuoyId | null {
  return spot.wave.primary ?? spot.wave.fallback ?? null;
}

/**
 * The reason a spot is out, in this module's own words.
 *
 * Written here rather than quoted from a file, because there is no surf zone
 * file to quote -- and that difference is stated to the reader rather than
 * papered over. `shared/spots.json`'s `notes` is free text and explicitly not
 * parsed, so its "No wave binding" sentence is evidence for this reason and not
 * the source of it.
 *
 * `not_in_zone`, never `unresolved`. An absent binding is not an unmeasured one:
 * the two spots it applies to are Batiquitos Lagoon and San Elijo Lagoon, which
 * are behind their mouths, and the entry in shared/spots.json is a deliberate
 * null rather than a gap. Calling them `unresolved` would say somebody has yet
 * to get around to measuring the surf in a lagoon.
 */
const NO_BINDING_REASON =
  'shared/spots.json binds no wave buoy to this spot — both wave.primary and ' +
  'wave.fallback are null — so nothing in this stack reports a wave height ' +
  'here. That is a stated absence, not an unmeasured one.';

/*
 * Both lists are built by walking SPOTS, so corridor order arrives correct
 * rather than being re-derived. spots.json runs north to south from Oceanside
 * Harbour to Border Field, and every ordered thing in this repo inherits that
 * order by preserving it -- the same argument core/zones/intertidal.ts makes.
 */
const members: SurfSpot[] = [];
const nonMembers: SurfNonMember[] = [];

for (const spot of SPOTS) {
  const boundBuoyId = boundBuoyOf(spot);
  if (boundBuoyId !== null) {
    members.push({ ...spot, boundBuoyId });
  } else {
    nonMembers.push({ spot, membership: 'not_in_zone', reason: NO_BINDING_REASON });
  }
}

/** Every member, in corridor order. */
export const SURF_SPOTS: readonly SurfSpot[] = members;

/** Every non-member, in corridor order, each carrying which bucket it is in. */
export const SPOTS_OUTSIDE_SURF: readonly SurfNonMember[] = nonMembers;

/**
 * What this zone accounts for, and the total it must add up to.
 *
 * Exported so a page can SHOW the arithmetic rather than implying it, exactly as
 * the intertidal grid does. Here the three buckets sum to the inventory by
 * construction -- the loop above puts every spot in one of two -- and that is
 * the reason to print it rather than a reason not to: a reader looking at 24
 * rows and 2 exclusions has no way to know 26 is the whole coast.
 */
export const SURF_ACCOUNTING = {
  members: members.length,
  notInZone: nonMembers.filter((n) => n.membership === 'not_in_zone').length,
  unresolved: nonMembers.filter((n) => n.membership === 'unresolved').length,
  inventory: SPOTS.length,
} as const;

/**
 * Resolve a slug to a member, or null.
 *
 * Null for an unknown slug and for a non-member alike; a caller that needs to
 * tell those apart calls `surfMembershipOf`. Looks in an array rather than an
 * object literal, so `__proto__` and the rest of Object.prototype's keys are
 * misses like any other unknown slug -- the trap shared/spots.generated.ts
 * documents at SPOT_BY_SLUG needs an object literal to spring.
 */
export function surfSpotBySlug(slug: string): SurfSpot | null {
  return members.find((m) => m.slug === slug) ?? null;
}

/**
 * Where a spot stands with this zone, or null if the slug is not a spot at all.
 *
 * The null is about the INVENTORY, not about this zone: an unknown slug is a
 * 404, and every real spot has an answer here by construction.
 */
export function surfMembershipOf(slug: string): SurfMembership | null {
  const member = members.find((m) => m.slug === slug);
  if (member) return { membership: 'member', spot: member };
  const nonMember = nonMembers.find((n) => n.spot.slug === slug);
  if (nonMember) {
    return { membership: nonMember.membership, spot: nonMember.spot, reason: nonMember.reason };
  }
  return null;
}

/** Whether a spot is a member of this zone. */
export function isSurfZoneMember(spot: Spot): boolean {
  return boundBuoyOf(spot) !== null;
}

/**
 * What this zone does not know, rendered on every page that shows a surf
 * verdict.
 *
 * A zone with no measured fact still owes a reader disclosure, and these are the
 * three things a surf page is most likely to be read as claiming and does not.
 * app/unresolved-sources.ts carries them to the page; #132 replaces that
 * hand-written list with a walk, and this array is written to be walked.
 */
export const SURF_ZONE_UNRESOLVED: readonly string[] = [
  'MEMBERSHIP HERE MEANS "A BUOY REPORTS WAVES FOR THIS SPOT", NOT "THIS IS A SURF BREAK". ' +
    'It is derived from the wave binding in shared/spots.json and from nothing else, because ' +
    'that binding is the only machine-readable thing this repo holds about the surf zone. So ' +
    'Oceanside Harbor is a member and is a harbor mouth, and Silver Strand is a member and is a ' +
    'sand barrier. Whether a spot breaks usably is a judgement, no upstream in this stack ' +
    'answers it, and the alternative on offer was the hand-populated audiences tag #125 deleted ' +
    'for being exactly that. See docs/adr/0014.',
  'THIS ZONE HOLDS NO MEASURED FACT. The intertidal has a floor with an instrument path to ' +
    'verified — lidar hypsometry, a pressure logger, MARINe transect topography — and the surf ' +
    'zone has no equivalent. Everything a surf verdict is decided against is an author estimate ' +
    'in activities/surf/thresholds.json, and #135 is the path off that for all of them. This is ' +
    'the answer to PRD #101 open question 2, not an omission from it.',
  'SIGNIFICANT WAVE HEIGHT AT THE BUOY IS NOT BREAKING HEIGHT AT THE BREAK. NDBC WVHT is the ' +
    'mean height of the highest third of the waves where the buoy floats, offshore or nearshore. ' +
    'No shoaling, refraction or shadowing transform is applied anywhere in this stack, and the ' +
    'corridor spans buoys 8 to 40 km apart serving spots whose exposure differs sharply — ' +
    "Scripps canyon focuses swell at Black's, and Point Loma shadows the spots behind it. A " +
    'reader comparing two spots is comparing two ceilings applied to two buoy readings, not two ' +
    'wave faces.',
];
