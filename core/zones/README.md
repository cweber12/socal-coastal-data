# core/zones

Facts true of **one cross-shore band** at a spot, independent of why anyone is
there.

| | |
| --- | --- |
| `intertidal.ts` | Which spots have a rocky intertidal, and the tide height at which each one surfaces. 8 members. |
| `surf.ts` | Which spots have a surf zone. Membership only, derived from the wave binding. 24 members. |

The four zones are `beach`, `intertidal`, `surf` and `subtidal`. Two have
modules. A file is added when there is something for it to say, never to fill the
set out.

## The two modules are not the same shape, and that is recorded

`intertidal.ts` joins a **measured fact** — the floor, provenance class 3, with
an append-only ledger and a promotion rule to `verified` — against
`shared/spots.json`, and states its membership in three explicit buckets in
`shared/intertidal.json`.

`surf.ts` has no measured fact and no file. Its membership is **derived**: a spot
is a member when `shared/spots.json` binds it a wave buoy, which is the only
machine-readable thing this repo holds about that band. An explicit list would
have been 26 hand-typed judgements with nothing checking them — which is the
`audiences` tag #125 deleted, rebuilt under a new name.

So `decision 1`'s symmetry is weaker than PRD #101 wrote it, and that is the
answer to its open question 2 rather than an omission from it. See
`docs/adr/0014-the-surf-zone-is-derived-membership-and-no-measured-fact.md`.

A zone with no measured fact still owes disclosure: `SURF_ZONE_UNRESOLVED` says
in the module what the membership does and does not claim, and
`app/unresolved-sources.ts` renders it.

## What belongs here, and what belongs next door

A zone answers *what is physically true in this band* — never *is it good*. The
tide height at which a bench surfaces is the same number for a photographer, a
MARINe surveyor and a child with a bucket, so it belongs here; whether that
makes a day worth the drive is an activity's judgement and belongs to one.

Belongs next door:

- **A fact true of the whole spot** — daylight, an operator's gate hours, the
  marine protected area it falls in — goes to `core/spot/`. A shut park gate
  keeps you out of every band at once, so it is never a zone's property.
- **A threshold** — a swell ceiling, a minimum useful window — is an author
  judgement and belongs to the activity that applies it.
- **A verdict** built from these facts belongs to an activity, and composing
  several belongs to the composition root.

## One zone may not import another

`scripts/check-boundaries.mjs` enforces it structurally rather than from its
table, because `core` has to permit `core` so a zone can read `core/time.ts`,
and `core` is a prefix of `core/zones/anything` — so no allow-list row can
express the rule. It is derived from the paths instead, which means it holds for
a zone nobody has written yet.

The reason is that the four zones **overlap and are not a partition**. A sandy
foreshore is both beach and intertidal; the surf zone is subtidal water whose
position moves with the tide while the intertidal's does not. A zone reading
another would make one band's facts depend on another's, and nothing may assume
a spot's zones tile its profile.

## The floor is class 3, and this directory is why the class has a home

`shared/intertidal.json` holds a **measured zone fact**: produced by this repo's
own instruments, carried by an append-only evidence ledger, neither joined from
an upstream authority nor typed in as a judgement. It is the third of the three
provenance classes in `CONTEXT.md` and it had no home until #124, which is the
reason the floor sat in `shared/spots.json` against that file's own rule.

`intertidal.ts` joins that file to `shared/spots.json` on slug and nowhere else.
It holds no coordinate, name or station binding of its own: a second copy of a
coordinate is a second thing to keep in step.

See `docs/adr/0002-measured-zone-facts-are-a-third-provenance-class.md` and
`docs/adr/0003-zone-membership-is-three-way.md`.
