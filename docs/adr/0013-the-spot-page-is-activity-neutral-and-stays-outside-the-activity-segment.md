# 0013 — The spot page is activity-neutral, and stays outside the activity segment

## Status

Accepted, 2026-07-31, in #127.

## Context

#127 introduces the activity route segment with tidepool as its only occupant.
PRD #101's target layout lists four routes:

```
app/page.tsx                            corridor overview
app/[activity]/page.tsx                 the verdict grid
app/[activity]/[slug]/[date]/page.tsx   the day page
app/spot/[slug]/page.tsx                facts once, verdicts on top
```

Three of those are unambiguous. The fourth is not: the layout puts the spot page
outside the segment, but the page as it stands today is entirely tidepool's — a
week of tidepool verdicts, a tidepool flag badge on every day, and a sightings
gallery whose target taxa are defined as "the animals people go to a tidepool to
see". Read from the current file rather than from the layout, `/tidepool/<slug>`
is the obvious home for it.

#127 has to answer this because #133 rebuilds that page, and it should not also
have to answer a routing question — a page cannot be designed while where it
lives is open.

## Decision

`/spot/[slug]` stays where it is. It does not move under `[activity]`.

The day page does move: `/spot/[slug]/[date]` becomes
`/[activity]/[slug]/[date]`, and the old path is a temporary redirect to it.

The split is by what the page is **about**. A day page answers *is it good here,
on this day, for this activity* — one verdict from one activity's thresholds, and
naming the activity in the URL is naming what decided it. A spot page answers
*what is true at this place*: where it is, which station and buoy it reads, its
MPA designation, whether a gate shuts it, what was seen there. Those facts do not
change with who is asking, and decision 10 of #101 is explicit that the page
states them **once** and stacks activities' verdicts on top.

A URL is a claim about what a page is. `/tidepool/la-jolla-cove` claims the page
below it is tidepool's; the moment surf lands, that page would have to either
duplicate under `/surf/la-jolla-cove` — rendering the same tide curve, the same
buoy reading and the same MPA notice twice — or keep serving both activities'
verdicts under a URL naming one of them.

## Alternatives considered

**Move it to `/[activity]/[slug]`, matching the day page.** Symmetric, and today
it would describe the file accurately. Rejected because it is accurate only while
there is one activity: it bakes an activity into the address of a page whose
whole design point is that it has none, and #133 would land its first commit
having to undo it. The tidepool content on that page today is a fact about how
far #133 has got, not about what the page is for.

**Keep the day page under `/spot/` too, and route only the grid.** A smaller
change, and it would have left `/spot/<slug>/<date>` untouched. Rejected because
the day page is exactly where an activity's judgement is most concentrated — the
flag badge on that panel is where a swell veto gets explained — and two
activities would have collided in the same path with nothing in the URL to
separate them. It also leaves the shape unproven, which is the point of routing
one activity first.

**Redirect the moved day path permanently (308).** Rejected. A 308 is cached by
browsers with no revalidation and no expiry, and what is on the other side of
this one is contingent on #133, which has not been decided. `app/robots.ts`
disallows the day path and the route sets `index: false, follow: false`, so no
crawler holds the address and no ranking rides on the hop — there is nothing to
buy with permanence and a decision that cannot be taken back to pay for it. The
root redirect is temporary for a stronger reason still: `/` stops being a
redirect the moment the corridor overview lands.

## Consequences

`/spot/[slug]` keeps its `generateStaticParams` over the eight intertidal spots,
and keeps linking into tidepool's day pages — through `tidepoolDayPath`, so the
link names the activity whose verdicts it leads to. That is the one seam where
this page still reaches into an activity, and it is the seam #133 has to
generalise when a second one exists.

Until the corridor overview lands, `/` redirects to `/tidepool` and the site
header points at `/`. The header is a link to the top of the site, and the top of
the site is what changes; the link does not have to.

`robots.txt` now derives its day-page rules from the routed-activity registry,
because the multiplication it guards against — every date being a distinct CO-OPS
request — repeats once per activity.
