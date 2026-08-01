# activities/surf

Surf's own thresholds. **There is no surf predicate yet** — #129 builds it.

| | |
| --- | --- |
| `thresholds.json` | The two per-spot swell ceilings the corridor default does not fit: `blacks-beach` 2.0 ft, `tourmaline` 4.0 ft. Both uncalibrated author estimates. |
| `thresholds.ts` | Reads them, asserts the units, and falls back to the corridor default. |

## Why the data landed before the activity

#128 had to put the two per-spot overrides somewhere. They were in
`shared/thresholds.json`, which is a corridor-wide file, and they are neither
corridor-wide nor tidepool's: both spots are outside the intertidal grid, both
overrides describe how those *breaks* differ, and neither has ever changed a
rendered verdict. Filing them here is what let `shared/thresholds.json` hold only
what applies to every spot.

So this directory is data and a reader, and #129 builds the predicate on top
rather than spending its first decision on where its thresholds live.

## What belongs here, and what belongs next door

Belongs here: surf's **judgement** — the ceilings, the band, and the states its
own predicate emits.

Belongs next door:

- **What is physically true in the surf zone** — wave height, period, direction —
  is a zone fact and goes to `core/zones/surf.ts`, which does not exist yet.
  Nothing here may assert one.
- **The corridor default ceiling** stays in `shared/thresholds.json`: it applies
  to every spot nothing specific has been said about, and every spot the grid
  renders today uses it.
- **Anything tidepool needs** is tidepool's. One activity may never import
  another, and `scripts/check-boundaries.mjs` enforces it structurally rather
  than from a table row — so a `surf -> tidepool` import fails the moment it is
  written, including before this directory had a row of its own.

## The caveats here are rendered

`unresolved` in `thresholds.json` is read by `app/unresolved-sources.ts` and
shown on every page, even though nothing computes a surf verdict. That is
deliberate: these two overrides were disclosed to readers the day before they
moved here, and a value that changes file must not quietly take its caveat off
the page. See ADR 0012.
