/**
 * A tide builder, so a case can be produced deliberately.
 *
 * TEST-ONLY. Nothing under `app/`, `core/` or `activities/` imports it; it is
 * not a `*.test.ts` file because two suites and the engine's own suite all need
 * it, and a test file that another test file imports would register its
 * `describe` blocks twice.
 *
 * It lived in `activities/tidepool/policy.test.ts` and was copied verbatim into
 * `activities/surf/policy.test.ts` by #129, along with the predicate it tested.
 * That copy is one of the duplications #130 removes.
 *
 * Extrema are given explicitly and the curve between consecutive ones is a half
 * cosine, which has zero slope at both ends. That means the turns land exactly
 * where they were asked for -- and it is roughly the shape of a real tide, so
 * the flood and ebb rates near a level are realistic rather than linear.
 *
 * Heights are quantised to three decimals exactly as CO-OPS quotes them, which
 * is why `findExtrema` recovers a turn a little off the requested instant --
 * most at the flattest turns. `expectNearMinute` below carries the tolerance.
 */

import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { utcMsFromZoned, type LocalDate } from '../../time';
import { parseCoopsSeries, type TideSeries } from '../../feeds/coops-predictions';

export const ZONE = 'America/Los_Angeles';

export interface Turn {
  /** Pacific wall clock, on `day` unless `dayOffset` says otherwise. */
  hour: number;
  minute?: number;
  ft: number;
  dayOffset?: number;
}

export function seriesFromTurns(
  day: LocalDate,
  turns: Turn[],
  zone: string = ZONE,
): TideSeries {
  const at = (t: Turn) =>
    utcMsFromZoned(
      { ...day, day: day.day + (t.dayOffset ?? 0), hour: t.hour, minute: t.minute ?? 0 },
      zone,
    );

  const points = turns.map((t) => ({ tMs: at(t), ft: t.ft })).sort((a, b) => a.tMs - b.tMs);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const STEP = 6 * 60_000;
  const samples: { tMs: number; ft: number }[] = [];

  for (let tMs = first.tMs; tMs <= last.tMs; tMs += STEP) {
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.tMs <= tMs) i++;
    const a = points[i]!;
    const b = points[i + 1]!;
    const u = (tMs - a.tMs) / (b.tMs - a.tMs);
    const eased = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;
    samples.push({ tMs, ft: Number((a.ft + (b.ft - a.ft) * eased).toFixed(3)) });
  }

  return {
    stationId: 'SYNTHETIC',
    datum: 'MLLW',
    units: 'ft',
    timeZone: 'UTC',
    samples,
    uniformStepMs: STEP,
  };
}

/** A series held at one height for four days. For the never-crossed cases. */
export function flatSeries(day: LocalDate, ft: number, zone: string = ZONE): TideSeries {
  return seriesFromTurns(
    day,
    [
      { hour: 0, ft, dayOffset: -1 },
      { hour: 12, ft, dayOffset: -1 },
      { hour: 12, ft },
      { hour: 12, ft, dayOffset: 1 },
      { hour: 12, ft, dayOffset: 2 },
    ],
    zone,
  );
}

/** An instant from a Pacific wall clock. */
export const pacific = (day: LocalDate, hour: number, minute = 0, zone: string = ZONE) =>
  utcMsFromZoned({ ...day, hour, minute }, zone);

/**
 * Assert a recovered turn is within `seconds` of where it was asked for.
 *
 * 90 s matches the tolerance the tide suite establishes against NOAA's own hilo
 * product, and it exists because the builder quantises to three decimals: a
 * parabola fitted to a quantised curve puts its vertex a little off the true
 * turn, most at the flattest ones.
 */
export const expectNearMinute = (actualMs: number, expectedMs: number, seconds = 90) =>
  expect(
    Math.abs(actualMs - expectedMs) / 1000,
    `${new Date(actualMs).toISOString()} vs expected ${new Date(expectedMs).toISOString()}`,
  ).toBeLessThanOrEqual(seconds);

/**
 * Assert WHICH turn was selected, rather than exactly where it landed.
 *
 * Used where the point of the test is a selection rule. Some builder cases have
 * deliberately lopsided spans -- a fourteen-hour ebb into a five-hour flood --
 * and a parabola fitted to a curve that asymmetric puts its vertex a couple of
 * minutes toward the flatter side. That is a property of the synthetic curve,
 * not of the selection being tested, so these assertions ask only that the
 * chosen turn is unambiguously the intended one of the two.
 */
export const expectPickedTurn = (
  actualMs: number,
  intendedMs: number,
  alternativeMs: number,
) => {
  const toIntended = Math.abs(actualMs - intendedMs);
  const toAlternative = Math.abs(actualMs - alternativeMs);
  expect(
    toIntended,
    `${new Date(actualMs).toISOString()} should be the turn near ` +
      `${new Date(intendedMs).toISOString()}, not ${new Date(alternativeMs).toISOString()}`,
  ).toBeLessThan(toAlternative);
  // And still close enough that it is that turn rather than some third one.
  expect(toIntended / 60_000).toBeLessThan(10);
};

/* ===========================================================================
 * The committed CO-OPS payloads, parsed once
 * ========================================================================= */

export const COOPS_CONTRACT = {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
} as const;

/**
 * One of the committed CO-OPS payloads, parsed through the shipped parser.
 *
 * Through the parser rather than hand-read, so a test asserting on real numbers
 * is asserting on what the app would actually compute from what the endpoint
 * actually served.
 */
export function loadCoopsFixture(name: string): TideSeries {
  return parseCoopsSeries(
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../feeds/__fixtures__/${name}`, import.meta.url)), 'utf8'),
    ),
    COOPS_CONTRACT,
  );
}
