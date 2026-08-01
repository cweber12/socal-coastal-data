# tools/tide-station

Measures what a predicate inherits from binding tide station 9410230 rather than
9410170. Re-runs the regression behind
https://github.com/cweber12/socal-coastal-data/issues/153.

```bash
python tools/tide-station/regress_stations.py            # 2000-2040, full table
python tools/tide-station/regress_stations.py --years 2016
python tools/tide-station/regress_stations.py --check    # exit 1 on drift
python tools/tide-station/regress_stations.py --write    # rewrite findings/
```

Standard library only. Reaches CO-OPS, so it is run deliberately rather than in
CI — same standing as `tools/verify-apis/` and `tools/county-station/`.

`findings/9410230-9410170-scale-term.json` is the committed record. `cache/` is
gitignored: what is committed is the coefficients, the queries and the counts,
and `--check` re-derives them from the live endpoint rather than trusting the
file.

**This tool changes nothing.** No binding, no threshold, no band edge. It reads
`activities/surf/thresholds.json`'s band to say what that band inherits, and has
no opinion about where the band should sit — that is
https://github.com/cweber12/socal-coastal-data/issues/135.

## What was measured

41 years of paired hi/lo predictions, 2000–2040, `interval=hilo`, `datum=MLLW`,
`units=english`, `time_zone=gmt`. Each 9410230 event matched to the nearest
**same-type** 9410170 event within 60 minutes.

```
9410230 events        57,191        matched pairs      57,183
9410170 events        57,357        unmatched               8
                                    reused partners         0
match offset          median 4 min, p99 16 min, max 42 min
```

Same-type is load-bearing: a high paired with a low inverts the comparison, and
near a shallow turn the two can be under an hour apart. The 60-minute window
never binds — the worst observed offset is 42 minutes — and no 9410170 event is
claimed by two 9410230 events, so the fit never reads one prediction twice.

### The relation

```
pooled 2000-2040   h_9410170 = 1.0696 x h_9410230 + 0.0245   r2 = 0.99871, n = 57,183
2016 alone         h_9410170 = 1.0741 x h_9410230 + 0.0147   r2 = 0.99883, n = 1,414
```

**2016 reproduces #148 F3 to every digit it published.** The intercept is
0.015–0.025 ft, so the relation is a **scale term, not an offset**: the two
stations agree near MLLW and diverge as the tide rises.

| h at 9410230 | h at 9410170 | difference |
| ---: | ---: | ---: |
| −1.50 ft | −1.580 | −0.080 |
| 0.00 | +0.025 | +0.025 |
| +0.70 | +0.773 | +0.073 |
| **+1.50** (band floor) | +1.629 | **+0.129** |
| +2.00 | +2.164 | +0.164 |
| **+3.50** (band ceiling) | +3.768 | **+0.268** |
| +5.00 | +5.373 | +0.373 |
| +7.00 | +7.512 | +0.512 |

The cleanest statement of the asymmetry needs no line at all. Across all 57,183
pairs, **79.3% of highs differ by more than 0.3 ft and not one low in 41 years
does** — the largest low-water difference on record is 0.294 ft.

### Two things this run found that #148 did not

**1. The coefficient is not a constant. It is on the lunar nodal cycle.**

Regressed year by year, the slope oscillates between **1.0658 (2025)** and
**1.0744 (2015)** — minima in 2005–2007 and 2023–2026, maxima in 2015 and 2034.
Min-to-min is ~18.7 years and max-to-max ~19, against the 18.61-year lunar nodal
cycle; the minima fall on the major lunar standstills of 2006 and 2025 and the
maxima on the minor standstills of 2015 and 2034. The mechanism is presumably
that nodal modulation is much stronger on the diurnal constituents than the
semidiurnal ones and the bay amplifies the two differently — **that part is not
verified here**, only the period and the phase.

#148 regressed 2016, which sits one year off the maximum: its 1.0741 is very
nearly the largest coefficient in the whole 41-year window, and by 2025 the true
value had fallen to 1.0658, 0.8% away. That matters if the number is used as a
coefficient and barely matters if it is used to look up a difference at a height,
which is the next paragraph.

**The difference at a given height is far more stable than the coefficient**,
because slope and intercept trade off almost exactly. Over all 41 years:

```
spread of the difference at +1.5 ft   0.007 ft   (0.126 to 0.132)
spread of the difference at +3.5 ft   0.011 ft   (0.263 to 0.274)
spread of the difference at +7.0 ft   0.041 ft   (0.494 to 0.535)
```

So the number to quote is the difference at a height, not the coefficient.

**2. The 0.5 ft is the cost of a mistake, not the cost of a choice.**

#148 F3 and #153 both read the divergence as what "a surf or dive predicate"
inherits at high water. That is true of **raw 9410170** — and raw 9410170 is not
a station anything here would read. `shared/spots.json` binds it `"bay side
only"`, and the one *published* route from it to the open coast is CO-OPS
subordinate station **TWC0405 Point Loma**, whose height offset is **0.92** on
its reference station 9410170 (fetched live by `--check`, not transcribed;
`refStationId: "9410170"`, `heightOffsetHighTide: 0.92`,
`heightOffsetLowTide: 0.92`, time offsets −9 min high and −2 min low).

Apply it, and the high-water divergence collapses:

| comparison | at lows | at highs |
| --- | ---: | ---: |
| raw `9410170 − 9410230` | median **+0.059** ft | median **+0.366** ft |
| derived `0.92 × 9410170 − 9410230` | median **−0.017** ft | median **−0.023** ft |

The derived Point Loma agrees with 9410230 **as well at high water as at low
water**. Which means #102 Finding 3's caveat — that its 0.06 ft daily-low result
"should not be read as validating 9410230 for high water" — is conservative
rather than binding: it compared a *derived* Point Loma at low water against a
*raw* 9410170 at high water. Measured like against like, the low-water result
does transfer.

That 0.92 is also the cross-check on the coefficient, and it is a better one than
#148 realised: CO-OPS publishes the **same** 0.92 for high and low tide, which is
independently the claim that the relation is a pure scale with no offset.
`1 / 1.0741 = 0.931` for 2016, **1.2%** from the published 0.92;
`1 / 1.0696 = 0.935` pooled over 41 years, **1.6%** from it.

### What the surf band actually inherits

The fitted line gives **+0.13 ft at the band floor and +0.27 ft at the ceiling** —
not the 0.5 ft #153's title claims for the band. The line does not reach 0.5 ft
until h = **6.83 ft**, which is nearly twice the band ceiling and within 0.4 ft of
HAT at 9410230 (+7.206 ft MLLW, the highest astronomical tide expected over 40
years). 0.5 ft is a real number about high water; it is not a number about this
band.

The conclusion #153 draws from 0.5 ft nevertheless survives, by a different
route. Of the 14,214 matched events whose 9410230 height falls inside the band,
the individual differences scatter well past the fitted line:

```
in band, all events    n 14,214   median +0.125   max +0.432   13.3% exceed 0.3 ft
in band, highs only    n  4,148   median +0.293   max +0.432   45.5% exceed 0.3 ft
in band, lows only     n 10,066   median +0.084   max +0.294    0.0% exceed 0.3 ft
```

**Whether the event is a high or a low matters as much as its height.** At the
same height inside the band a high water differs by ~0.29 ft and a low water by
~0.08 ft, and the split at §7's 0.3 ft promotion tolerance is total: 45.5% of
in-band highs clear it, no in-band low ever does. A single scale term averages
over that distinction, which is why the fitted line at the band ceiling sits
under the tolerance while nearly half the events there sit above it.

### Band occupancy, which is what a predicate actually computes

The regression matches turning points, so it isolates range and excludes the
bay's phase lag. A predicate walking a 6-minute series inherits both. Over the
384-hour window the committed fixture covers (`20260713`, 3,841 shared samples):

```
minutes inside the 1.5-3.5 ft band     9410230  10,200      (the bound station)
                                   raw 9410170   9,684      -5.1%
                        0.92 x 9410170 (TWC0405) 10,740     +5.3%
samples whose band membership flips    raw 9410170  11.1%
                                    derived TWC0405  6.6%
```

One fortnight is not a year and this is not offered as an annual figure. It is
here because it is the only one of the three measurements in the units a session
is reported in.

## What this does not do

It does not answer #148 open question 3 — which station a surf or dive predicate
*wants* at high water. It removes one argument in that question (the apparent
0.5 ft penalty for a 9410170-derived station, which the published 0.92 route does
not carry) and adds nothing on the other side: **nothing in the corridor measures
open-coast high water directly**, and no observation was compared here at all,
only predictions against predictions. Recording the size of the choice is not
making it.

## The failure mode worth naming

`spots.json` carries `"tide_station": "9410230"` on all 26 spots. Changing that
string to `"9410170"` is a one-token edit, and it would raise every high-water
reading by up to 0.6 ft while moving the daily low by hundredths — so a tidepool
floor gate would barely twitch while a surf band shifted underneath. The half of
the stack most likely to be watched is the half least able to see it.

That is the case for the 0.92: the divergence is what you inherit by
*substituting* the bay station, not by *deriving* from it.
