/**
 * Tide maths. Pure: no network, no ambient clock, no I/O.
 *
 * Three jobs: parse a CO-OPS predictions payload, find the extrema in a
 * prediction series, and compute daylight bounds for a place and a date.
 *
 * ---------------------------------------------------------------------------
 * What the CO-OPS payload does and does not tell you
 * ---------------------------------------------------------------------------
 *
 * Measured against api.tidesandcurrents.noaa.gov/api/prod/datagetter on
 * 2026-07-27, station 9410230, not recalled:
 *
 *   { "predictions" : [
 *   {"t":"2026-07-27 02:56", "v":"5.805", "type":"H"}, ... ]}
 *
 * Three traps, each of which this module refuses to walk into:
 *
 * 1. `t` CARRIES NO OFFSET. "2026-07-27 02:56" is UTC only because the request
 *    said time_zone=gmt. Ask for time_zone=lst_ldt and you get the same shape
 *    with Pacific digits, and tagging those UTC ages every reading by 7 hours.
 *    verify_coastal_apis.py already carries a comment about exactly this bug.
 *    So the timezone is a REQUIRED argument here and 'gmt' is the only accepted
 *    value. There is no default, because a default is how the wrong one gets
 *    used.
 *
 * 2. NEITHER THE UNIT NOR THE DATUM APPEARS IN THE PAYLOAD. `v` is a string of
 *    digits. It is feet because the request said units=english, and it is
 *    relative to MLLW because the request said datum=MLLW. Both are request-side
 *    facts, so the caller declares them and they travel with the parsed series
 *    rather than being re-assumed at each use site.
 *
 * 3. ERRORS ARRIVE AT HTTP 200. A bad datum returns
 *    {"error": {"message": "No Predictions data was found..."}} with a 200
 *    status. Freshness beats status: a 200 carrying no predictions is a dead
 *    response and throws here, so it can never be mistaken for a flat tide.
 */

import { formatLocalDate, type LocalDate } from './time';

/* ===========================================================================
 * Types
 * ========================================================================= */

/**
 * What the caller asked CO-OPS for. Declared, not inferred, because none of it
 * is recoverable from the response body.
 */
export interface CoopsRequestContract {
  /** Station id the request named, e.g. '9410230'. */
  stationId: string;
  /**
   * The `time_zone=` value used. Only 'gmt' is accepted: the payload timestamps
   * have no offset, and 'gmt' is the one setting under which reading them as
   * UTC is correct.
   */
  timeZone: 'gmt';
  /** The `units=` value used. Only 'english' is accepted, which means feet. */
  units: 'english';
  /** The `datum=` value used, e.g. 'MLLW'. Carried through, never assumed. */
  datum: string;
}

/** One prediction sample. `tMs` is epoch ms, i.e. UTC by construction. */
export interface TideSample {
  tMs: number;
  /** Height above the series datum, in the series units. */
  ft: number;
}

export interface TideExtremum {
  tMs: number;
  ft: number;
  kind: 'high' | 'low';
}

export interface TideSeries {
  stationId: string;
  /** Carried from the request contract. */
  datum: string;
  /** Always 'ft' -- the contract only permits units=english. */
  units: 'ft';
  /**
   * Present so nothing downstream has to remember which clock the numbers are
   * on. Always 'UTC', because the contract only permits time_zone=gmt.
   */
  timeZone: 'UTC';
  samples: TideSample[];
  /**
   * Sample spacing in ms when the series is evenly spaced, else null. Parabolic
   * refinement in findExtrema requires even spacing and is skipped without it,
   * rather than producing a subtly wrong extremum time.
   */
  uniformStepMs: number | null;
}

export interface TideCrossing {
  tMs: number;
  /** Which way the tide was moving through the level. */
  direction: 'falling' | 'rising';
}

/* ===========================================================================
 * The request, pinned in the same module as the parser
 * ========================================================================= */

export const COOPS_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * Build a predictions request.
 *
 * This lives beside the parser rather than beside the fetch, because the three
 * parameters the payload cannot tell you about -- time_zone, units and datum --
 * are the same three the parser demands as a declared contract. Splitting them
 * across two files is how they drift apart, and the whole cost of them drifting
 * is a silently wrong number.
 *
 * lib/upstream.ts and the calibration pipeline both call this. upstream.ts
 * cannot be imported outside a React Server Component -- it opens with
 * `import 'server-only'` and passes `next: { revalidate }` to fetch -- so
 * without this the calibration pipeline would have had to restate the contract,
 * which is exactly the second source of truth issue #32 forbids.
 *
 * `application` is the caller's own courtesy identifier and is deliberately not
 * defaulted: it is how NOAA tells the web app's traffic from the pipeline's,
 * and a default would make both of them look like whichever was written first.
 *
 * `beginDate` is interpreted by CO-OPS in the requested zone, which is GMT
 * here, so a date means 00:00 UTC on that date.
 */
export function coopsPredictionsUrl(options: {
  stationId: string;
  beginDate: LocalDate;
  rangeHours: number;
  datum: string;
  application: string;
}): string {
  const params = new URLSearchParams({
    product: 'predictions',
    application: options.application,
    station: options.stationId,
    // The one setting under which reading the offsetless timestamps as UTC is
    // correct. lst_ldt returns the same shape with Pacific digits and ages every
    // reading by 7 hours; verify_coastal_apis.py carries a comment about exactly
    // that bug.
    time_zone: 'gmt',
    units: 'english',
    format: 'json',
    datum: options.datum,
    begin_date: formatLocalDate(options.beginDate).replace(/-/g, ''),
    range: String(options.rangeHours),
  });
  return `${COOPS_BASE}?${params.toString()}`;
}

/* ===========================================================================
 * Parsing
 * ========================================================================= */

/** Exactly the shape CO-OPS emits. Anything else is drift and throws. */
const COOPS_T_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

interface RawRow {
  t: string;
  v: string;
  type?: string;
}

function assertContract(contract: CoopsRequestContract): void {
  if (contract.timeZone !== 'gmt') {
    throw new Error(
      `CO-OPS contract: time_zone must be 'gmt', got ${JSON.stringify(contract.timeZone)}. ` +
        'Prediction timestamps carry no offset, so any other setting means the ' +
        'digits are on an unknown clock and reading them as UTC shifts every ' +
        'value by the zone offset.',
    );
  }
  if (contract.units !== 'english') {
    throw new Error(
      `CO-OPS contract: units must be 'english', got ${JSON.stringify(contract.units)}. ` +
        'The payload does not state its unit, so a metric response would be ' +
        'read as feet and understate every height by a factor of 3.28.',
    );
  }
  if (typeof contract.datum !== 'string' || contract.datum.length === 0) {
    throw new Error(
      'CO-OPS contract: datum must be stated. Heights are relative to it and ' +
        'the payload does not carry it.',
    );
  }
  if (typeof contract.stationId !== 'string' || contract.stationId.length === 0) {
    throw new Error('CO-OPS contract: stationId must be stated.');
  }
}

/**
 * Pull the prediction rows out of a payload, failing loudly on every way the
 * endpoint can answer without giving predictions.
 */
function readRows(payload: unknown, contract: CoopsRequestContract): RawRow[] {
  if (payload === null || typeof payload !== 'object') {
    throw new Error(`CO-OPS ${contract.stationId}: expected a JSON object, got ${typeof payload}`);
  }
  const obj = payload as Record<string, unknown>;

  // The 200-with-an-error case. Reported before the missing-predictions case so
  // the upstream message survives into the error.
  if ('error' in obj && obj.error !== null && obj.error !== undefined) {
    const message =
      typeof obj.error === 'object' && obj.error !== null && 'message' in obj.error
        ? String((obj.error as { message: unknown }).message)
        : JSON.stringify(obj.error);
    throw new Error(
      `CO-OPS ${contract.stationId} returned an error body: ${message} ` +
        '(note: CO-OPS serves these with HTTP 200)',
    );
  }

  const rows = obj['predictions'];
  if (!Array.isArray(rows)) {
    throw new Error(
      `CO-OPS ${contract.stationId}: no 'predictions' array in the response. ` +
        `Top-level keys: ${Object.keys(obj).join(', ') || '(none)'}`,
    );
  }
  if (rows.length === 0) {
    throw new Error(
      `CO-OPS ${contract.stationId}: 'predictions' is empty. A 200 carrying no ` +
        'predictions is a dead response, not a flat tide.',
    );
  }
  return rows as RawRow[];
}

/**
 * `"2026-07-27 02:56"` under a gmt contract to epoch ms.
 *
 * Built with Date.UTC from the captured digits rather than handed to
 * `new Date(string)`. A space-separated datetime is not an ISO 8601 form, so
 * Date's handling of it is implementation-defined, and some engines read it as
 * local time -- which is the 7-hour bug arriving by a different route.
 */
function parseGmtStamp(raw: string, stationId: string, index: number): number {
  const m = COOPS_T_PATTERN.exec(raw);
  if (!m) {
    throw new Error(
      `CO-OPS ${stationId} row ${index}: timestamp ${JSON.stringify(raw)} does not ` +
        'match the pinned "YYYY-MM-DD HH:MM" shape. The payload format has drifted.',
    );
  }
  const [year, month, day, hour, minute] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error(
      `CO-OPS ${stationId} row ${index}: timestamp ${JSON.stringify(raw)} is out of range`,
    );
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (!Number.isFinite(ms)) {
    throw new Error(`CO-OPS ${stationId} row ${index}: timestamp ${JSON.stringify(raw)} is unusable`);
  }
  return ms;
}

function parseHeight(raw: unknown, stationId: string, index: number): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new Error(
      `CO-OPS ${stationId} row ${index}: height ${JSON.stringify(raw)} is neither string nor number`,
    );
  }
  const text = String(raw).trim();
  // Number('') is 0. A blank height must not become a zero-foot tide.
  if (text === '') {
    throw new Error(`CO-OPS ${stationId} row ${index}: height is blank`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(
      `CO-OPS ${stationId} row ${index}: height ${JSON.stringify(raw)} is not a finite number`,
    );
  }
  // Sanity bound. The largest tidal range on Earth is about 53 ft at Fundy; the
  // corridor's is under 9. A value outside this means the datum or unit is not
  // what the contract claims.
  if (value < -20 || value > 70) {
    throw new Error(
      `CO-OPS ${stationId} row ${index}: height ${value} ft is outside any plausible ` +
        'tidal range. The datum or unit is not what the contract declares.',
    );
  }
  return value;
}

function assertMonotonic(samples: TideSample[], stationId: string): void {
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    if (cur.tMs <= prev.tMs) {
      throw new Error(
        `CO-OPS ${stationId}: timestamps are not strictly increasing at row ${i} ` +
          `(${new Date(prev.tMs).toISOString()} then ${new Date(cur.tMs).toISOString()}). ` +
          'Interpolation and extremum detection both assume ordering.',
      );
    }
  }
}

/** The single spacing shared by every consecutive pair, or null if they differ. */
function uniformStep(samples: TideSample[]): number | null {
  if (samples.length < 2) return null;
  const step = samples[1]!.tMs - samples[0]!.tMs;
  for (let i = 2; i < samples.length; i++) {
    if (samples[i]!.tMs - samples[i - 1]!.tMs !== step) return null;
  }
  return step;
}

/**
 * Parse the default (6-minute) predictions product into a series.
 *
 * Rejects rows carrying `type`, because those come from `interval=hilo` and are
 * four points a day, not a series. Handing them to findExtrema or heightAt
 * would silently interpolate straight lines between tide peaks.
 */
export function parseCoopsSeries(
  payload: unknown,
  contract: CoopsRequestContract,
): TideSeries {
  assertContract(contract);
  const rows = readRows(payload, contract);

  const samples: TideSample[] = rows.map((row, i) => {
    if (row.type !== undefined) {
      throw new Error(
        `CO-OPS ${contract.stationId} row ${i}: row carries type=${JSON.stringify(row.type)}, ` +
          'so this is the interval=hilo product. Use parseCoopsExtrema for that; ' +
          'treating four daily peaks as a series interpolates straight lines ' +
          'between them.',
      );
    }
    return {
      tMs: parseGmtStamp(row.t, contract.stationId, i),
      ft: parseHeight(row.v, contract.stationId, i),
    };
  });

  assertMonotonic(samples, contract.stationId);

  return {
    stationId: contract.stationId,
    datum: contract.datum,
    units: 'ft',
    timeZone: 'UTC',
    samples,
    uniformStepMs: uniformStep(samples),
  };
}

/**
 * Parse the `interval=hilo` product into extrema.
 *
 * Used to cross-check findExtrema against NOAA's own answer, and available to
 * the UI where four labelled peaks are all that is wanted.
 */
export function parseCoopsExtrema(
  payload: unknown,
  contract: CoopsRequestContract,
): TideExtremum[] {
  assertContract(contract);
  const rows = readRows(payload, contract);

  const extrema: TideExtremum[] = rows.map((row, i) => {
    if (row.type !== 'H' && row.type !== 'L') {
      throw new Error(
        `CO-OPS ${contract.stationId} row ${i}: expected type 'H' or 'L', got ` +
          `${JSON.stringify(row.type)}. Without it there is no way to tell a high ` +
          'from a low, and a high read as a low inverts the whole window.',
      );
    }
    return {
      tMs: parseGmtStamp(row.t, contract.stationId, i),
      ft: parseHeight(row.v, contract.stationId, i),
      kind: row.type === 'H' ? 'high' : 'low',
    };
  });

  for (let i = 1; i < extrema.length; i++) {
    if (extrema[i]!.tMs <= extrema[i - 1]!.tMs) {
      throw new Error(`CO-OPS ${contract.stationId}: hilo rows are not strictly increasing at ${i}`);
    }
    if (extrema[i]!.kind === extrema[i - 1]!.kind) {
      throw new Error(
        `CO-OPS ${contract.stationId}: two consecutive ${extrema[i]!.kind}s at row ${i}. ` +
          'Highs and lows must alternate; a gap means rows are missing.',
      );
    }
  }

  return extrema;
}

/* ===========================================================================
 * Series maths
 * ========================================================================= */

/**
 * Local minima and maxima of a prediction series.
 *
 * Two refinements over naive neighbour comparison, both of which matter at
 * 6-minute sampling:
 *
 *   - Equal-valued runs. Predictions are quoted to three decimals and adjacent
 *     samples near a turn do tie. A run is treated as one candidate and its
 *     extremum placed at the midpoint of the run, rather than being missed
 *     because neither strict inequality held.
 *
 *   - Parabolic interpolation. The true turn falls between samples, up to 3
 *     minutes from the nearest one, and the sampled height at the turn is
 *     slightly shallower than the real peak. Fitting a parabola through the
 *     three points around the candidate recovers both.
 *
 * Refinement needs even spacing and is skipped when the series does not have
 * it, which loses precision rather than inventing it.
 *
 * Measured against NOAA's own interval=hilo product for station 9410230 over
 * 2026-07-27 to 07-29, all 12 extrema:
 *
 *   height   worst 0.001 ft
 *   time     mean 18 s, worst 60 s
 *
 * The worst case is instructive. It is the shallow "higher low" of 28 July at
 * 2.381 ft, and it has the smallest curvature of the twelve -- 0.003 ft per
 * 6-minute step squared, against 0.006 at the turns that match exactly. Heights
 * are quoted to three decimals, so at that curvature the quantisation is a
 * sixth of the parabola's denominator and the fitted offset gets noisy. Flat
 * turns are the limit of this method, and no amount of arithmetic recovers
 * precision the source does not carry.
 *
 * That 60 s does not propagate into window length: the window edges come from
 * `crossings`, which interpolates where the tide passes the floor and is
 * well-conditioned precisely because the tide is moving fast there. The
 * extremum time is what gets displayed as "the low", where a minute is
 * immaterial.
 *
 * NOAA also reports hilo times to the whole minute, so up to 30 s of that 60 s
 * is their rounding rather than this method's error.
 */
export function findExtrema(series: TideSeries): TideExtremum[] {
  const s = series.samples;
  if (s.length < 3) {
    throw new Error(
      `findExtrema: need at least 3 samples to identify a turn, got ${s.length}`,
    );
  }

  // Collapse runs of identical height so a tie at the turn is still a candidate.
  const runs: { ft: number; first: number; last: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const tail = runs[runs.length - 1];
    if (tail && tail.ft === s[i]!.ft) tail.last = i;
    else runs.push({ ft: s[i]!.ft, first: i, last: i });
  }

  const out: TideExtremum[] = [];

  for (let r = 1; r < runs.length - 1; r++) {
    const before = runs[r - 1]!;
    const run = runs[r]!;
    const after = runs[r + 1]!;

    const isHigh = run.ft > before.ft && run.ft > after.ft;
    const isLow = run.ft < before.ft && run.ft < after.ft;
    if (!isHigh && !isLow) continue;
    const kind = isHigh ? 'high' : 'low';

    // A plateau: the turn is somewhere inside the flat stretch, and its midpoint
    // is the least wrong single answer.
    if (run.first !== run.last) {
      out.push({
        tMs: Math.round((s[run.first]!.tMs + s[run.last]!.tMs) / 2),
        ft: run.ft,
        kind,
      });
      continue;
    }

    const i = run.first;
    const prev = s[i - 1]!;
    const cur = s[i]!;
    const next = s[i + 1]!;

    const stepBack = cur.tMs - prev.tMs;
    const stepFwd = next.tMs - cur.tMs;
    const evenlySpaced = series.uniformStepMs !== null || stepBack === stepFwd;

    if (!evenlySpaced) {
      out.push({ tMs: cur.tMs, ft: cur.ft, kind });
      continue;
    }

    // Parabola through (-1, prev), (0, cur), (+1, next) in units of one step.
    const denom = prev.ft - 2 * cur.ft + next.ft;
    if (denom === 0) {
      out.push({ tMs: cur.tMs, ft: cur.ft, kind });
      continue;
    }
    const offset = (0.5 * (prev.ft - next.ft)) / denom;

    // |offset| > 0.5 would place the turn nearer a neighbour than the candidate,
    // which means the three points are not bracketing a turn. Do not trust it.
    if (!Number.isFinite(offset) || Math.abs(offset) > 0.5) {
      out.push({ tMs: cur.tMs, ft: cur.ft, kind });
      continue;
    }

    out.push({
      tMs: Math.round(cur.tMs + offset * stepFwd),
      ft: cur.ft - 0.25 * (prev.ft - next.ft) * offset,
      kind,
    });
  }

  return out;
}

/**
 * Height at an arbitrary instant, by linear interpolation between samples.
 *
 * Throws outside the series rather than clamping to the end. A clamped value is
 * a real-looking number for a time the series says nothing about, which is
 * exactly the class of answer this repo exists to avoid.
 */
export function heightAt(series: TideSeries, tMs: number): number {
  const s = series.samples;
  const first = s[0];
  const last = s[s.length - 1];
  if (!first || !last) throw new Error('heightAt: series has no samples');
  if (tMs < first.tMs || tMs > last.tMs) {
    throw new Error(
      `heightAt: ${new Date(tMs).toISOString()} is outside the series ` +
        `[${new Date(first.tMs).toISOString()}, ${new Date(last.tMs).toISOString()}]`,
    );
  }

  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid]!.tMs <= tMs) lo = mid;
    else hi = mid;
  }

  const a = s[lo]!;
  const b = s[hi]!;
  if (b.tMs === a.tMs) return a.ft;
  const f = (tMs - a.tMs) / (b.tMs - a.tMs);
  return a.ft + f * (b.ft - a.ft);
}

/**
 * Instants at which the series crosses `levelFt`, with the direction of travel.
 *
 * Linear interpolation between the bracketing samples. At 6-minute spacing and
 * a tide moving at roughly 1 ft/hour near the floor, the interpolation error is
 * well under a minute -- far below the resolution anyone acts on.
 */
export function crossings(series: TideSeries, levelFt: number): TideCrossing[] {
  const s = series.samples;
  const out: TideCrossing[] = [];

  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    const da = a.ft - levelFt;
    const db = b.ft - levelFt;

    if (da === 0 && db === 0) continue; // sitting exactly on the level: no crossing
    if (da === 0) {
      // Starts on the level and leaves it. Direction comes from where it goes.
      out.push({ tMs: a.tMs, direction: db > 0 ? 'rising' : 'falling' });
      continue;
    }
    if (db === 0) continue; // handled on the next iteration, as that pair's `da`
    if (da > 0 === db > 0) continue; // same side, no crossing

    const f = da / (da - db);
    out.push({
      tMs: Math.round(a.tMs + f * (b.tMs - a.tMs)),
      direction: db < da ? 'falling' : 'rising',
    });
  }

  return out;
}

/** The samples within `[fromMs, toMs]`, for charting a single day. */
export function sliceSeries(series: TideSeries, fromMs: number, toMs: number): TideSeries {
  const samples = series.samples.filter((s) => s.tMs >= fromMs && s.tMs <= toMs);
  return { ...series, samples, uniformStepMs: uniformStep(samples) };
}

/* ===========================================================================
 * Daylight
 * ===========================================================================
 *
 * NOAA's solar position algorithm, the same one behind
 * gml.noaa.gov/grad/solcalc. Offline and pure -- there is no sun API in this
 * stack and there should not be, because the sun is the one upstream that
 * cannot rot.
 *
 * ---------------------------------------------------------------------------
 * Which oracle this was checked against, and why it matters
 * ---------------------------------------------------------------------------
 *
 * Three sources were compared for La Jolla on 2026-07-27, and they do not
 * agree with each other:
 *
 *   USNO (aa.usno.navy.mil)   rise 05:59      set 19:51      (to the minute)
 *   api.sunrisesunset.io      rise 05:58:49   set 19:51:57
 *   api.sunrise-sunset.org    rise 05:58:17   set 19:52:51
 *
 * sunrise-sunset.org is the outlier: its rise rounds to 05:58 and its set to
 * 19:53, both of which contradict USNO. It runs the simplified Almanac for
 * Computers algorithm, which is about 80 s wide at each end. Had it been taken
 * as the oracle, a correct implementation would have looked broken and the
 * "fix" would have been to widen the horizon constant until the numbers matched
 * a worse source.
 *
 * USNO is the authority and is what the tests assert against, at its own
 * one-minute reporting resolution, over six cases spanning both solstices, both
 * equinoxes and both ends of the corridor.
 *
 * Accuracy actually achieved: within 30 s of USNO's reported minute on all six.
 * That is well inside anything a person acts on, but it is NOT nothing against
 * the 45-minute window threshold -- roughly 1 minute of a 45-minute call. The
 * threshold should not be read as exact to the second.
 */

const DEG = Math.PI / 180;
const rad = (d: number) => d * DEG;
const deg = (r: number) => r / DEG;

/**
 * Sunrise and sunset are defined at 90.833° from the zenith, not 90°: 34
 * arcminutes of atmospheric refraction plus the sun's own 16-arcminute
 * semidiameter, since the moment named is when the upper limb touches the
 * horizon. Dropping it puts both instants about three minutes wrong.
 */
const SUNRISE_ZENITH_DEG = 90.833;

/** Julian Day at 00:00 UTC on a Gregorian calendar date. */
function julianDayAtUtcMidnight(date: LocalDate): number {
  let y = date.year;
  let m = date.month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + date.day + b - 1524.5
  );
}

interface SolarTerms {
  /** Solar declination, degrees. */
  declinationDeg: number;
  /** Equation of time, minutes. */
  eqTimeMin: number;
}

function solarTerms(julianDay: number): SolarTerms {
  const jc = (julianDay - 2451545) / 36525;

  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  const eqCtr =
    Math.sin(rad(meanAnom)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * jc) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;

  const trueLong = meanLong + eqCtr;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * jc));

  const meanObliq =
    23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * jc));

  const declinationDeg = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));

  const varY = Math.tan(rad(obliqCorr / 2)) ** 2;
  const eqTimeMin =
    4 *
    deg(
      varY * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * varY * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * varY * varY * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)),
    );

  return { declinationDeg, eqTimeMin };
}

export type Daylight =
  | {
      kind: 'sun-crosses-horizon';
      sunriseMs: number;
      sunsetMs: number;
      solarNoonMs: number;
      /** Sunrise to sunset, in minutes. */
      dayLengthMin: number;
    }
  | { kind: 'sun-never-rises'; solarNoonMs: number }
  | { kind: 'sun-never-sets'; solarNoonMs: number };

/**
 * Sunrise, sunset and solar noon for a place and a calendar date.
 *
 * `date` is the local calendar date. The returned instants bracket solar noon
 * for that date, and sunset legitimately falls on the following UTC date west
 * of Greenwich -- for this corridor, sunset is always tomorrow in UTC terms.
 * The returned instants are epoch ms and carry no zone, so that is a fact about
 * how they render, not about what they are.
 *
 * This holds wherever the civil offset tracks longitude, which covers the whole
 * US West Coast. The test suite asserts that solar noon lands on the requested
 * date in America/Los_Angeles for every day of a year at both ends of the
 * corridor, so the assumption is checked rather than trusted.
 *
 * The polar cases cannot arise in this corridor but are returned as distinct
 * results rather than being clamped, because a clamped 00:00-to-00:00 day would
 * read as a perfectly ordinary dark day.
 */
export function daylightBounds(lat: number, lon: number, date: LocalDate): Daylight {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`daylightBounds: latitude ${lat} is out of range`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`daylightBounds: longitude ${lon} is out of range`);
  }

  const midnightJd = julianDayAtUtcMidnight(date);
  const midnightMs = Date.UTC(date.year, date.month - 1, date.day);

  // Locate solar noon first. The equation of time is evaluated at noon rather
  // than at 00:00 UTC; one refinement pass gets there. Skipping it leaves the
  // transit about 30 s out.
  let solarNoonMin = 720 - 4 * lon - solarTerms(midnightJd).eqTimeMin;
  for (let pass = 0; pass < 2; pass++) {
    const terms = solarTerms(midnightJd + solarNoonMin / 1440);
    solarNoonMin = 720 - 4 * lon - terms.eqTimeMin;
  }
  const solarNoonMs = Math.round(midnightMs + solarNoonMin * 60_000);

  /** Half-day length in minutes, using the declination at a given instant. */
  const halfDayMinAt = (minutesFromUtcMidnight: number): number | 'never-rises' | 'never-sets' => {
    const { declinationDeg } = solarTerms(midnightJd + minutesFromUtcMidnight / 1440);
    const cosHourAngle =
      Math.cos(rad(SUNRISE_ZENITH_DEG)) /
        (Math.cos(rad(lat)) * Math.cos(rad(declinationDeg))) -
      Math.tan(rad(lat)) * Math.tan(rad(declinationDeg));
    if (cosHourAngle > 1) return 'never-rises';
    if (cosHourAngle < -1) return 'never-sets';
    // Four minutes of clock per degree of hour angle.
    return 4 * deg(Math.acos(cosHourAngle));
  };

  const atNoon = halfDayMinAt(solarNoonMin);
  if (atNoon === 'never-rises') return { kind: 'sun-never-rises', solarNoonMs };
  if (atNoon === 'never-sets') return { kind: 'sun-never-sets', solarNoonMs };

  /*
   * Refine each event against the declination at that event rather than at
   * transit. Declination moves up to 0.4 deg/day away from the solstices, and
   * sunrise sits about seven hours before transit, so the noon value is roughly
   * 0.09 deg wrong at each end -- about 15 s of clock. It also makes the day
   * legitimately asymmetric about transit, which the single-declination form
   * cannot represent.
   *
   * Two passes converge to well under a second at these latitudes. A pass that
   * strays into a polar result keeps the previous estimate: that can only happen
   * within a hair of the polar boundary, and the noon classification above has
   * already decided the case.
   */
  const refine = (initial: number, sign: 1 | -1): number => {
    let eventMin = initial;
    for (let pass = 0; pass < 2; pass++) {
      const half = halfDayMinAt(eventMin);
      if (typeof half !== 'number') return eventMin;
      eventMin = solarNoonMin + sign * half;
    }
    return eventMin;
  };

  const sunriseMin = refine(solarNoonMin - atNoon, -1);
  const sunsetMin = refine(solarNoonMin + atNoon, 1);

  return {
    kind: 'sun-crosses-horizon',
    sunriseMs: Math.round(midnightMs + sunriseMin * 60_000),
    sunsetMs: Math.round(midnightMs + sunsetMin * 60_000),
    solarNoonMs,
    dayLengthMin: sunsetMin - sunriseMin,
  };
}
