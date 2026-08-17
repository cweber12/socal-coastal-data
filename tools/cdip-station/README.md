# tools/cdip-station

Re-derives the eight `cdip` ids in `shared/spots.json`'s `buoys` block from
CDIP's own active-station list, checks each buoy's live/dead claim against it,
and re-derives each dead buoy's `dead_since` from the deployment file that value
names.

```bash
python tools/cdip-station/rejoin.py            # exit 1 if a mapping or a claim moved
python tools/cdip-station/rejoin.py --verbose  # every buoy, moved or not
```

Standard library only. Reaches cdip.ucsd.edu, so it is run deliberately rather
than in CI — same standing as `tools/verify-apis/`.

## Why this exists

The `buoys` block maps every NDBC id to a CDIP id **by hand**. Eight values, no
join behind them, no recorded retrieval, and no re-run path — exactly the state
`tools/county-station/rejoin.py` and `tools/mpa/rejoin.py` took their own
bindings out of, still standing in the same file.

`https://cdip.ucsd.edu/data_access/sccoos.cdip` is the authority: one
tab-delimited row per **active** station, no key, no markup beyond a `<pre>`
wrapper. CDIP names it on their data-access page as the script "To get a summary
of our active stations including location, wave parameters and depth".

## It asks CDIP because NDBC is downstream of CDIP

CDIP's data-access page states the direction of flow:

> Every thirty minutes the latest measurements from CDIP's buoys are transmitted
> to the NDBC in FM-13 format.

So `ndbc.noaa.gov/data/realtime2/<id>.txt` is a relay, and a 404 there is a fact
about the relay before it is a fact about the buoy. That distinction is
load-bearing in this corridor: NDBC 46235 404s, and CDIP's archive shows station
155 was **recovered** on 2026-05-03 rather than left silent.

## What it pins, and what it merely reports

**Pinned — a mismatch stops the run with exit 2:** the URL, the `<pre>` wrapper
at both ends, ten fields per row, a three-digit zero-padded station id, and that
no station id appears twice. The feed publishes no header, so every column is
read by position and a shifted column would be read as a different quantity.

**Pinned, and this is the check that earns the script — the published NAME, not
merely the presence of the id.** `045` appearing in the list is not evidence
that `045` is Oceanside Offshore. Every id in the file is a real CDIP station,
so a transposed pair would pass a presence check and bind a spot to the wrong
water. Names are compared with the state suffix stripped and both sides
upper-cased — exactly, never fuzzily.

**Reported, never fatal:** row counts, each buoy's published position, and its
distance to the nearest spot that binds it. Positions are not in `spots.json`,
so there is nothing to diff them against; they are printed as a sanity check,
because a grossly mis-mapped id shows up as a buoy nowhere near the spots that
read it. When the registry in
<https://github.com/cweber12/socal-coastal-data/issues/105> has somewhere to put
them, they become a diff.

**Fatal — exit 1:** a live buoy absent from the list, a DEAD one present in it,
or a name that disagrees. The middle one is the `REVIVED` signal in its weakest
form, and CLAUDE.md's rule applies — either it came back or the reason it was
written off no longer holds, and both need a human.

## It re-derives `dead_since`, and deliberately not `status`

`status: dead` is **inferred**, and inferred from absence — a 404, an empty
payload, a row missing from the active list. That is a judgement, so this script
reports the disagreement and exits 1 for a human to act on; it never writes the
field. `dead_since` is **published**: CDIP states `time_coverage_end` as a global
attribute of the deployment file, so the value is transcribed rather than
decided, which makes it the same kind of thing as `mpa` and `county_station` —
and for those, hand-typing is the violation rather than the safeguard. The axis
is [ADR 0017](../../docs/adr/0017-published-is-a-join-inferred-is-a-judgement.md).

The read is one request to the `.das` on the dodsC path — the Dataset Attribute
Structure, which is the file's attributes as plain text, so no netCDF reader and
no dependency is needed:

```
https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/155p1/155p1_d14.nc.das
```

**Pinned:** the deployment file **named in the committed value**, never "the
latest". Attributes are read from the `NC_GLOBAL` block by brace-matching rather
than grepped out of the whole file — the three keys are unique today, but a
variable-level `date_created` is a legitimate addition and would silently shift
the read. `wmo_id` must equal the NDBC key, so a transposed station id cannot
confirm a date from another buoy's file. Both timestamps the committed prose
quotes are compared to the publisher, which is what stops the prose drifting
while the date still matches.

**Reported, never fatal:** the gap between `time_coverage_end` and
`date_created` — 36.9 h for `155p1_d14.nc`. That short gap is what the `note`'s
"recovered rather than left silent" rests on, and it is printed rather than
asserted because CDIP publishes no recovery event.

**Reported, never fatal:** a `dead_since` that does not parse as a re-derivable
claim. `"unknown; realtime2 404 as of 2026-07-27"` was an honest answer while
nobody had asked CDIP, and an unstated date cannot be a wrong one. Only a value
claiming to be resolved can fail.

Pointing the committed value one deployment earlier is the case worth knowing
about: `155p1_d13.nc` ends `2025-01-22T17:59:59Z`, two hours before d14 begins.
Deployments abut, so the wrong file yields a **plausible** date rather than an
absurd one, which is why the filename is pinned and not inferred.

## Two things it refuses to do

**Field 6 has no published unit, and this script does not invent one.** Reading
it as centimetres makes Point Loma South 1049.8 m and Del Mar Nearshore 17.0 m,
and both are right for those buoys. That inference is strong enough to be
dangerous: it is the IBWC cubic-metres-per-second problem in its exact shape —
not a wrong unit, a correct unit with an unrecorded conversion behind it. The
raw integer is carried verbatim. Asked upstream as open question 1 of
<https://github.com/cweber12/socal-coastal-data/issues/177>.

**The timestamp carries no offset.** `08.16.2026-01:30:00` read at 18:30 Pacific
is consistent with UTC, and CDIP publishes UTC in its netCDF, but this feed
asserts nothing. The newest stamp is printed verbatim and nothing is derived
from it. No freshness assertion is made, because the only one available would
encode the guess.

## What it does not watch for

**A redeployment of station 155.** A recovered hull does not resume answering;
it gets redeployed, and that appears at CDIP as a `155p1` deployment beyond 14
before any byte reaches NDBC. Watching for it is
<https://github.com/cweber12/socal-coastal-data/issues/180> and belongs beside
the other tripwires in `verify_coastal_apis.py`. This script answers "does the
committed record still hold", once, on demand.

Pinning the named deployment is what keeps that boundary: because the check reads
`155p1_d14.nc` rather than the newest file, a `155p1_d15` appearing leaves it
**green**. The committed value's "the fourteenth and **last**" is therefore not
verified here — only the date, its two quoted attributes, and that the file
belongs to this buoy.

## What a clean run looks like

As of 2026-08-17, against the live feed:

```
shared/spots.json 3.1.2 | https://cdip.ucsd.edu/data_access/sccoos.cdip
  79 active stations published; 8 buoys in the inventory
  newest row stamped 08.17.2026-13:00:00 -- VERBATIM: the feed states no offset,
  and nothing here derives from it

  dead_since, re-derived from the archive (1 dead):
   46235 / cdip 155  dead_since 2026-05-03 reproduces from 155p1_d14.nc
     time_coverage_end 2026-05-03T05:59:59Z   wmo_id 46235 confirms the file is
     this buoy
     archived 36.9 h after it stopped -- REPORTED, never asserted.
     NOT CHECKED HERE: that this is still the LAST deployment.

cdip-station: all 8 buoys reproduce -- 7 live and present under the published
name, 1 marked dead and absent, 1 of 1 dead_since re-derived from the deployment
file named.
```

`--verbose` adds a line per buoy. The distances that run shows are 1.1 km at Del
Mar Nearshore to 23.9 km at Point Loma South — and Point Loma South's nearest
bound spot is `cabrillo-tidepools`, which is the substitution
`core/zones/surf.ts` discloses, measured rather than recalled.
