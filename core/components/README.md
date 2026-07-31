# core/components

Shells. Presentation with no activity in it.

| | |
| --- | --- |
| `disclosure.tsx` | The evaluation stamp, the notice list, the upstream-failure banner. |
| `midnight-notice.tsx` | Tells a reader the page's idea of "today" has rolled over. |
| `spot-protection.tsx` | The marine protected area a spot falls in, and what a null means. |
| `spot-row.tsx` | Row frame: cells and panel rendered on the server and handed in as props. |
| `unresolved.tsx` | What the stack does not know, in the words of the files that say so. |

## What belongs here, and what belongs next door

The test is an import, not a judgement. A component belongs here when it can be
written without naming an activity — no verdict states, no floor, no ceiling, no
activity's labels. Six of the twelve components that used to sit flat in
`components/` failed that test and are now under
`activities/tidepool/components/`.

`disclosure.tsx` is the case worth reading. It renders notices and nothing else,
which makes it a shell — but it took the `Notice` type from the grid, and a core
component importing an activity is the one edge the boundary check exists to
forbid. Four lines with no activity in them were holding a whole component on
the wrong side of the line, so `Notice` moved to `core/notice.ts`. When something
here looks like it belongs but will not compile, that is usually the shape of it.

## Shells and slots, not yet

Decision 9 of PRD #101 describes `core/components/` owning frames — `CellShell`,
`RibbonFrame`, `ChartFrame` — with each activity passing its innards as
children. That extraction has **not** happened. What has happened is that
components already free of an activity moved here, and the rest did not.

Pulling a `CellShell` out of `window-cell.tsx` while tidepool is the only
occupant would be guessing what surf's cell needs from the frame. #133 does the
extraction against two real activities, on the same grounds ADR 0008 gives for
the solver. `spot-row.tsx` is the exception and is already a frame — it takes
its cells and panel as props, which is why it was able to move at all.

## No domain maths in the client bundle

Everything a shell renders is computed on the server and handed in. The pattern
`spot-row.tsx` documents is the one to follow: a component that would need to
import a predicate to render is a component in the wrong place.
