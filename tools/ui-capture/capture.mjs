#!/usr/bin/env node
/*
 * Capture the pages a refactor could silently change, as PNGs and as text.
 *
 * The text is the point. The PNG is for a human to look at when something is
 * already known to have moved; nothing diffs it. See compare.mjs and this
 * directory's README for why a pixel comparison is the wrong control here.
 *
 *   npm run build
 *   npm run ui:capture -- <out-dir> [--date YYYY-MM-DD] [--port 3000] [--no-server]
 *
 * ---------------------------------------------------------------------------
 * Two things that cost an hour each, written down so they cost nobody again
 * ---------------------------------------------------------------------------
 *
 * `next start` opens the TCP port BEFORE it is willing to serve. Waiting on a
 * bind and then navigating gives ERR_CONNECTION_REFUSED, or worse
 * ERR_CONNECTION_RESET, which reads like a crash rather than a race. This waits
 * on a real HTTP 200 from `/`.
 *
 * `localhost` resolves to the IPv6 loopback on Windows and the connection is
 * refused, while curl to the same name succeeds. Every URL here is 127.0.0.1.
 *
 * Standard library plus playwright, which is a devDependency and never a
 * dependency. Nothing under app/, core/ or activities/ may import tools/ --
 * scripts/check-boundaries.mjs enforces it -- so none of this can reach a
 * bundle.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const OUT = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
const PORT = Number(flag('port', '3000'));
const MANAGE_SERVER = !args.includes('--no-server');
const BASE = `http://127.0.0.1:${PORT}`;

if (!OUT) {
  console.error('usage: node tools/ui-capture/capture.mjs <out-dir> [--date YYYY-MM-DD] [--port N] [--no-server]');
  process.exit(2);
}

/**
 * The capture date, which is a parameter rather than "today" on purpose.
 *
 * Two captures taken either side of local midnight would request different day
 * pages and be incomparable, and the failure would look like a content change.
 * compare.mjs refuses to compare two runs that disagree on it.
 */
const DATE = flag('date', todayInCorridor());

function todayInCorridor() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const at = (t) => parts.find((p) => p.type === t).value;
  return `${at('year')}-${at('month')}-${at('day')}`;
}

const WIDTHS = [375, 768, 1280];
const THEMES = ['light', 'dark'];

/**
 * The pages a move can break without failing a test.
 *
 * State coverage is opportunistic: which verdicts appear depends on the tide on
 * the captured date, so a run cannot promise a `veto` or a `dark` cell. That is
 * a real limit of this tool and is why it supplements the suite rather than
 * replacing it -- the states themselves are asserted in the predicate's own
 * tests against fixtures, where they are chosen rather than hoped for.
 *
 * The paths are the canonical ones, not the redirects. #127 moved the grid to
 * `/tidepool` and the day page under it, leaving `/` and `/spot/<slug>/<date>`
 * as temporary redirects; capturing through those would still reach the same
 * pages, and would quietly go on passing on the day a redirect is removed.
 *
 * The capture NAMES are unchanged, which is what let #127 use this as its own
 * control: compare.mjs matches before and after by name, so a run from `main`
 * requesting `/` and a run from the branch requesting `/tidepool` are compared
 * as the same page -- which is exactly the claim a route move has to make.
 */
const pages = (date) => [
  ['grid', '/tidepool'],
  ['day-cabrillo-published', `/tidepool/cabrillo-tidepools/${date}`],
  ['day-windansea-refused', `/tidepool/windansea/${date}`],
  ['spot-sunset-cliffs', '/spot/sunset-cliffs'],
  ['spot-windansea', '/spot/windansea'],
];

async function reachable() {
  try {
    const res = await fetch(BASE + '/', { signal: AbortSignal.timeout(3000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await reachable()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function killTree(child) {
  if (process.platform === 'win32') {
    // Synchronous on purpose. `child.kill()` leaves the `next start` grandchild
    // holding the port, and spawning taskkill ASYNCHRONOUSLY loses the race
    // against process exit -- which is how the first version of this left a
    // server running and made the next run capture the previous build.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  // Confirm rather than assume: the guard at the top of the next run is a worse
  // place to discover this failed.
  for (let i = 0; i < 20; i++) {
    if (!(await reachable())) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`Warning: something is still serving ${BASE} after the kill.`);
}

let server = null;
if (MANAGE_SERVER) {
  if (await reachable()) {
    console.error(
      `Something is already serving ${BASE}. Stop it, or pass --no-server if it is the build you mean to capture.`,
    );
    process.exit(2);
  }
  server = spawn('npm', ['run', 'start', '--', '--port', String(PORT)], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });
  if (!(await waitForServer())) {
    await killTree(server);
    console.error('Server never returned HTTP 200. Has `npm run build` been run?');
    process.exit(1);
  }
} else if (!(await reachable())) {
  console.error(`Nothing serving ${BASE}. Run: npm run build && npm run start`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const report = [];

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      for (const [name, path] of pages(DATE)) {
        const stem = `${name}-${width}-${theme}`;
        await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.screenshot({ path: join(OUT, `${stem}.png`), fullPage: true });

        /*
         * The PNG is the DEFAULT view; the text is EVERYTHING. Hence the order:
         * screenshot first, then expand, then read.
         *
         * `innerText` returns rendered text, and a collapsed <details> renders
         * none of its contents. This page keeps a great deal behind them -- the
         * unresolved caveats, the per-row spot disclosure, and the excluded-spots
         * section, which is the one #126 rewrote. All of it was invisible to this
         * control: #124 diffed 30 captures and reported one changed line, and it
         * could not have seen the excluded section change at all. A control that
         * cannot fail over a whole region of the page is the failure this
         * directory's README warns about in its own terms, one layer in.
         *
         * Expanding after the screenshot keeps the image representative of what
         * a reader lands on, and makes the diffed text cover what they can reach.
         */
        const detailsOpened = await page.$$eval('details', (list) => {
          let n = 0;
          for (const d of list) {
            if (!d.open) n++;
            d.open = true;
          }
          return n;
        });

        const body = await page.innerText('body');
        writeFileSync(join(OUT, `${stem}.txt`), body, 'utf8');
        report.push({ file: stem, route: path, chars: body.length, detailsOpened, errors: [...errors] });
        errors.length = 0;
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  if (server) await killTree(server);
}

writeFileSync(join(OUT, '_report.json'), JSON.stringify({ date: DATE, captures: report }, null, 1), 'utf8');

const bad = report.filter((r) => r.errors.length > 0);
const opened = report.reduce((n, r) => n + r.detailsOpened, 0);
console.log(
  `ui-capture: ${report.length} captures for ${DATE}, ${opened} disclosures expanded before reading text, ` +
    `${bad.length} with console or page errors`,
);
for (const b of bad) console.log(`  ${b.file}: ${b.errors.slice(0, 2).join(' | ')}`);
process.exit(bad.length > 0 ? 1 : 0);
