# tools/ui-capture

Proves a refactor did not change what a reader sees.

```bash
npm run build
npm run ui:capture -- tools/ui-capture/out/before      # on main
# switch branch, rebuild
npm run ui:capture -- tools/ui-capture/out/after
npm run ui:compare -- tools/ui-capture/out/before tools/ui-capture/out/after
```

5 pages × 375/768/1280 × light and dark = 30 captures, each written as a PNG and
as the page's rendered text. **Only the text is diffed.** The PNG is there for a
human to look at once something is known to have moved.

Exits non-zero on any difference, so it can gate a move PR.

## Why not diff the committed screenshots

`.design/ui-polish/screenshots/` are design-review artefacts captured on
2026-07-28 against `spots.json` 1.2.0. The grid is `force-dynamic`: it renders
live CO-OPS and NDBC readings, stamped with the instant it was evaluated at.
A capture taken today differs from those for reasons that have nothing to do with
a refactor — different dates, different floors, a longer unresolved list.

Diffing against them reports the tide changing. The control has to be **the same
code, two commits, minutes apart**, which is what this does.

## Why text and not pixels

A pixel diff on a page whose content is live is either flaky or so tolerant it
proves nothing. Text is exact, and when it moves it says which line.

Two fields legitimately differ between two runs and are the only things
normalised:

```
Evaluated <when>    the instant the render happened
<N> min old         age of the newest buoy observation at that instant
```

Nothing else. Normalising more would build a diff that cannot fail. In #122 and
#123 *every* difference across all thirty captures was `55 min old` becoming
`56 min old`, and the result meant something precisely because that was the only
thing filtered out.

## Two failures that cost an hour each

Both are handled in `capture.mjs`; they are recorded here because they look like
crashes rather than races.

- **`next start` opens the TCP port before it will serve.** Waiting on a bind and
  then navigating gives `ERR_CONNECTION_REFUSED`, or worse
  `ERR_CONNECTION_RESET`. Wait on a real HTTP 200.
- **`localhost` resolves to the IPv6 loopback on Windows** and is refused, while
  `curl` to the same name succeeds. Every URL here is `127.0.0.1`.

A third, found while building this: `child.kill()` leaves the `next start`
grandchild holding the port, and killing it *asynchronously* loses the race
against process exit. The first version left a server running, and the next run
captured the **previous build** with no error at all. The kill is now synchronous
and confirmed by polling the port, and a run refuses to start if something is
already serving.

## What this does not cover

State coverage is opportunistic. Which verdicts appear depends on the tide on the
captured date, so a run cannot promise a `veto` or a `dark` cell. The states
themselves are asserted in the window predicate's own tests against committed
fixtures, where they are chosen rather than hoped for. This supplements the
suite; it does not replace it.

`--date` defaults to today in `America/Los_Angeles` and is recorded in
`_report.json`. `compare.mjs` refuses to compare two runs that disagree on it —
captures either side of local midnight request different day pages, and that
would otherwise read as a content change.

## Not in CI

It needs a browser and a built app, and the useful form needs `main` as a
control, which a single CI checkout does not have. It belongs with
`verify_coastal_apis.py`: run deliberately, not per push.

Playwright is a `devDependency` and never a `dependency`. Browser binaries are a
separate opt-in download — `npx playwright install chromium` — so `npm ci` in CI
installs the package and downloads no browser. Nothing under `app/`, `core/` or
`activities/` may import `tools/`, and `scripts/check-boundaries.mjs` enforces
it, so none of this can reach a bundle.

Output goes to `tools/ui-capture/out/`, which is gitignored. A before/after
control is compared and then thrown away; committing one would put a live tide
reading under version control and invite it being diffed against months later,
which is the mistake this tool exists to avoid.
