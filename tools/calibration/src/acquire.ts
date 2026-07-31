/**
 * Acquisition: iNaturalist observations and CO-OPS predictions.
 *
 * The only part of the pipeline that touches the network, and the only part that
 * writes to the cache. Everything it produces is handed to the pure modules.
 *
 * ---------------------------------------------------------------------------
 * v2 rather than the v1 the PRD named
 * ---------------------------------------------------------------------------
 *
 * Same reason as lib/inat.ts, measured on 2026-07-28: v1 has no field selection
 * -- `fields` is silently ignored -- and serves ~75 kB per record. Cabrillo alone
 * holds 3,308 research-grade records of these thirteen taxa since 2016, so the
 * corridor on v1 is a quarter of a gigabyte. On v2 with the field list below a
 * record is ~460 bytes and the whole corridor is a few megabytes.
 *
 * ---------------------------------------------------------------------------
 * Which filters run here, and which run in memory
 * ---------------------------------------------------------------------------
 *
 * `quality_grade=research` is sent, because it roughly halves the volume and
 * every downstream stage assumes it. Its attrition is measured with a separate
 * one-record count query, so stage 1 still reports a surviving count.
 *
 * `geoprivacy` and `captive` are NOT sent, and that is deliberate. #32 requires
 * "obscuring losses by taxon" as a report diagnostic, and a record filtered
 * server-side cannot be counted. They are dropped in memory instead, which
 * yields the identical record set and a measurable one. The dropped records are
 * counted and nothing else -- an obscured coordinate is randomised within a
 * ~0.2 degree cell, so it is never placed, never binned, and never used to
 * establish that a visit happened.
 *
 * `positional_accuracy` is not filtered at all, per #32. iNaturalist's
 * `acc_below` silently excludes null accuracy along with imprecise accuracy, and
 * at Cabrillo #30 measured those as 21.5% and 14% -- two different things, one
 * number. Both fractions are reported separately instead.
 *
 * The radius sent is the WIDEST in the sensitivity grid, and the shipped radius
 * is applied in memory. One pull serves every cell of the grid, so the grid
 * costs no requests and every cell is drawn from the identical record set.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { coopsPredictionsUrl, parseCoopsSeries, type TideSeries } from '../../../core/feeds/coops-predictions.ts';
import { distanceMetres } from '../../../core/feeds/inat-observations.ts';
import type { LocalDate } from '../../../core/time.ts';
import type { CalibrationRecord } from './join.ts';
import { PER_PAGE, REQUEST_INTERVAL_MS, RESULT_WINDOW_LIMIT } from './config.ts';

const USER_AGENT =
  'socal-coastal-data/0.1 (+https://github.com/cweber12/socal-coastal-data) calibration';

const INAT_BASE = 'https://api.inaturalist.org/v2/observations';

/** Exactly what the calibration reads. See lib/inat.ts on why this list is short. */
export const CALIBRATION_FIELDS = [
  'id',
  'observed_on',
  'time_observed_at',
  'location',
  'geoprivacy',
  'taxon_geoprivacy',
  'obscured',
  'captive',
  'quality_grade',
  'positional_accuracy',
  'user.login',
  'taxon.id',
  // Without ancestry the one genus target, Phyllospadix, matches nothing: its
  // records are P. torreyi and P. scouleri.
  'taxon.ancestor_ids',
].join(',');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: LocalDate) => `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;

export interface PullOptions {
  slug: string;
  lat: number;
  lon: number;
  radiusKm: number;
  taxonIds: readonly number[];
  since: LocalDate;
  /** Restrict to redistributable photos. Used only when capturing fixtures. */
  licenses?: readonly string[];
}

export function inatPullUrl(options: PullOptions, idAbove: number): string {
  const params = new URLSearchParams({
    lat: String(options.lat),
    lng: String(options.lon),
    radius: String(options.radiusKm),
    quality_grade: 'research',
    taxon_id: options.taxonIds.join(','),
    d1: isoDate(options.since),
    per_page: String(PER_PAGE),
    // id_above cursoring REQUIRES ascending id order. Any other sort makes the
    // cursor meaningless and the walk non-terminating or lossy.
    order_by: 'id',
    order: 'asc',
    id_above: String(idAbove),
    fields: CALIBRATION_FIELDS,
  });
  if (options.licenses && options.licenses.length > 0) {
    params.set('license', options.licenses.join(','));
  }
  return `${INAT_BASE}?${params.toString()}`;
}

/* ===========================================================================
 * The cursored pull
 * ========================================================================= */

export interface RawPull {
  slug: string;
  /** Every page's `results`, concatenated in cursor order. */
  results: unknown[];
  /** iNaturalist's own count for the query, from the first page. */
  totalResults: number;
  pages: number;
  /**
   * `results.length - total_results`. Zero on a clean walk.
   *
   * Non-fatal by design: the corpus moves under a fifty-page pull as records
   * reach research grade. Carried so a large discrepancy is visible instead of
   * being the thing nobody thought to look at.
   */
  countDelta?: number;
  /** The URL of the first page, so a number in the report traces to a query. */
  firstUrl: string;
  pulledAt: string;
}

/**
 * Walk a spot's whole result set with `id_above`.
 *
 * The 10,000-result window is the reason this exists. `page`-based paging
 * returns HTTP 403 past it -- measured, with iNaturalist's own message naming
 * `id_above` as the fix -- and a try/except around that 403 produces a silently
 * truncated, order-biased sample that looks exactly like a complete one.
 *
 * Three assertions, because a cursor walk fails silently by nature:
 *
 *   ids strictly increase across the whole walk, so no page overlaps or skips;
 *   the walk stops on a short page, not on a count, so it cannot end early on a
 *   `total_results` that moved between requests;
 *   the accumulated count is compared against `total_results` and any shortfall
 *   is carried out on the pull rather than swallowed. It is NOT fatal: records
 *   get identified to research grade while a fifty-page walk is in flight, so a
 *   small discrepancy in either direction is ordinary. A large one is not, and
 *   the only way to tell is to report the number.
 */
export async function pullSpot(
  options: PullOptions,
  pulledAt: string,
  /**
   * Milliseconds between pages. Defaults to the courtesy rate iNaturalist asks
   * for, and exists as a parameter only so the cursoring tests -- which walk
   * several pages against a stub that is not iNaturalist -- do not spend ten
   * seconds asleep proving something about arithmetic.
   */
  intervalMs: number = REQUEST_INTERVAL_MS,
): Promise<RawPull> {
  const results: unknown[] = [];
  let idAbove = 0;
  let pages = 0;
  let totalResults = 0;
  let firstUrl = '';
  let lastId = -Infinity;

  for (;;) {
    const url = inatPullUrl(options, idAbove);
    if (pages === 0) firstUrl = url;
    if (pages > 0 && intervalMs > 0) await sleep(intervalMs);

    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.status === 403) {
      throw new Error(
        `iNaturalist ${options.slug}: HTTP 403 on page ${pages + 1}. That is the ` +
          `${RESULT_WINDOW_LIMIT}-result window, which id_above cursoring is supposed to ` +
          'avoid entirely -- so the cursor is not being applied. Refusing to continue with a ' +
          'truncated sample.',
      );
    }
    if (!response.ok) {
      throw new Error(`iNaturalist ${options.slug}: HTTP ${response.status} for ${url}`);
    }

    const payload = (await response.json()) as { results?: unknown[]; total_results?: number };
    if (!Array.isArray(payload.results)) {
      throw new Error(`iNaturalist ${options.slug}: no results array on page ${pages + 1}.`);
    }
    if (pages === 0) {
      if (typeof payload.total_results !== 'number') {
        throw new Error(`iNaturalist ${options.slug}: no total_results on the first page.`);
      }
      totalResults = payload.total_results;
    }
    pages++;

    for (const row of payload.results) {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== 'number') {
        throw new Error(`iNaturalist ${options.slug}: a row carries no numeric id.`);
      }
      if (id <= lastId) {
        throw new Error(
          `iNaturalist ${options.slug}: id ${id} is not greater than the previous ${lastId}. ` +
            'The cursor walk is overlapping or out of order, so completeness cannot be claimed.',
        );
      }
      lastId = id;
      results.push(row);
      idAbove = id;
    }

    // Stop on a short page, never on a count: total_results can move between
    // requests as records are identified, and stopping on it would end the walk
    // early on a corpus that grew mid-pull.
    if (payload.results.length < PER_PAGE) break;
  }

  return {
    slug: options.slug,
    results,
    totalResults,
    pages,
    countDelta: results.length - totalResults,
    firstUrl,
    pulledAt,
  };
}

/* ===========================================================================
 * Parsing a pulled row
 * ========================================================================= */

/** Why records did not survive, counted per stage. */
export interface PullExclusions {
  notResearchGrade: number;
  captive: number;
  obscured: number;
  noLocation: number;
  outsideRadius: number;
  noObservedOn: number;
}

const OBSERVED_ON = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCATION = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
/** An offset is required. See lib/inat.ts for the trap this closes. */
const TIME_OBSERVED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const WITHHELD_GEOPRIVACY = ['obscured', 'private'];

export interface ParsedPull {
  records: CalibrationRecord[];
  /** Dropped for geoprivacy. Counted by taxon and otherwise unused. */
  obscuredRecords: CalibrationRecord[];
  exclusions: PullExclusions;
  /** Records rejected for a future-dated timestamp. Counted, per #32. */
  futureDated: number;
}

/**
 * Turn raw rows into records, counting every exclusion.
 *
 * Structural drift throws. A record that is merely unwanted is counted and
 * dropped. That is the same split lib/inat.ts uses, and the reason is the same:
 * the consequence of mishandling an obscured record is real, so the guard should
 * be a guard rather than a tripwire that aborts a fifty-page pull.
 */
export function parsePull(
  rows: readonly unknown[],
  spot: { slug: string; lat: number; lon: number },
  radiusKm: number,
  nowMs: number,
): ParsedPull {
  const records: CalibrationRecord[] = [];
  const obscuredRecords: CalibrationRecord[] = [];
  const exclusions: PullExclusions = {
    notResearchGrade: 0,
    captive: 0,
    obscured: 0,
    noLocation: 0,
    outsideRadius: 0,
    noObservedOn: 0,
  };
  let futureDated = 0;

  for (const [index, raw] of rows.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`${spot.slug} row ${index}: expected an object.`);
    }
    const row = raw as Record<string, unknown>;

    const id = row['id'];
    if (typeof id !== 'number') throw new Error(`${spot.slug} row ${index}: id is not a number.`);

    if (row['quality_grade'] !== 'research') {
      exclusions.notResearchGrade++;
      continue;
    }
    if (row['captive'] === true) {
      exclusions.captive++;
      continue;
    }

    const observedOnRaw = row['observed_on'];
    if (typeof observedOnRaw !== 'string' || !OBSERVED_ON.test(observedOnRaw)) {
      // Without a local date there is no visit key and no day to take a minimum
      // over. Counted rather than guessed at from the timestamp, which would put
      // a Pacific evening record on the following day.
      exclusions.noObservedOn++;
      continue;
    }
    const m = OBSERVED_ON.exec(observedOnRaw)!;
    const observedOn: LocalDate = {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
    };

    let observedAtMs: number | null = null;
    const timeRaw = row['time_observed_at'];
    if (typeof timeRaw === 'string' && timeRaw !== '') {
      if (!TIME_OBSERVED.test(timeRaw)) {
        throw new Error(
          `${spot.slug} row ${index}: time_observed_at ${JSON.stringify(timeRaw)} carries no ` +
            'explicit UTC offset, so the digits are on an unknown clock.',
        );
      }
      observedAtMs = Date.parse(timeRaw);
    }

    /*
     * Future-dated records, counted per #32.
     *
     * #30 measured ZERO of these across every filtered spot-zone, and explains
     * why: they appear in a 14-day recent window, which is what
     * verify_coastal_apis.py samples, and a historical research-grade corpus has
     * none. The check stays because "we measured zero once" is not the same as
     * "this cannot happen", and a count of zero is itself the finding.
     */
    if (observedAtMs !== null && observedAtMs > nowMs) {
      futureDated++;
      continue;
    }

    const locationRaw = row['location'];
    if (typeof locationRaw !== 'string' || locationRaw === '') {
      exclusions.noLocation++;
      continue;
    }
    const coords = LOCATION.exec(locationRaw);
    if (!coords) {
      throw new Error(
        `${spot.slug} row ${index}: location ${JSON.stringify(locationRaw)} is not "lat,lng".`,
      );
    }
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);

    const user = row['user'];
    const login =
      typeof user === 'object' && user !== null ? (user as { login?: unknown }).login : undefined;
    if (typeof login !== 'string' || login === '') {
      throw new Error(
        `${spot.slug} row ${index}: user.login is missing, so this record has no visit key.`,
      );
    }

    const taxon = row['taxon'];
    if (typeof taxon !== 'object' || taxon === null) {
      throw new Error(`${spot.slug} row ${index}: no taxon object.`);
    }
    const taxonId = (taxon as { id?: unknown }).id;
    const ancestorIdsRaw = (taxon as { ancestor_ids?: unknown }).ancestor_ids;
    if (typeof taxonId !== 'number') {
      throw new Error(`${spot.slug} row ${index}: taxon.id is not a number.`);
    }
    if (!Array.isArray(ancestorIdsRaw)) {
      throw new Error(
        `${spot.slug} row ${index}: taxon.ancestor_ids is missing. Without ancestry the genus ` +
          'target matches nothing and would be silently reported as absent.',
      );
    }

    const accuracyRaw = row['positional_accuracy'];
    const record: CalibrationRecord = {
      id,
      observerLogin: login,
      observedOn,
      observedAtMs,
      lat,
      lon,
      distanceM: distanceMetres(spot.lat, spot.lon, lat, lon),
      positionalAccuracyM: typeof accuracyRaw === 'number' ? accuracyRaw : null,
      taxonId,
      ancestorIds: ancestorIdsRaw.filter((a): a is number => typeof a === 'number'),
    };

    if (
      row['obscured'] === true ||
      WITHHELD_GEOPRIVACY.includes(String(row['geoprivacy'])) ||
      WITHHELD_GEOPRIVACY.includes(String(row['taxon_geoprivacy']))
    ) {
      // Kept only so the by-taxon loss table can count it. Its coordinate is
      // randomised, so it is never placed and never binned.
      exclusions.obscured++;
      obscuredRecords.push(record);
      continue;
    }

    if (record.distanceM > radiusKm * 1000) {
      exclusions.outsideRadius++;
      continue;
    }

    records.push(record);
  }

  return { records, obscuredRecords, exclusions, futureDated };
}

/* ===========================================================================
 * CO-OPS: one request per year
 * ========================================================================= */

/**
 * The predicted series across a span of years.
 *
 * #30 measured that CO-OPS serves a whole year of 6-minute predictions in one
 * request -- `begin_date=20240101&range=8760` returned 87,601 samples. Eleven
 * years is eleven requests, which is what makes committed offline fixtures for
 * the tide join realistic rather than aspirational.
 *
 * `range` is set from the year's real length so a leap year is not short by a
 * day, and the seam checks below are what prove the concatenation is sound
 * rather than merely plausible.
 */
export async function fetchYearSeries(
  stationId: string,
  datum: string,
  fromYear: number,
  toYear: number,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<{ series: TideSeries; urls: string[] }> {
  const urls: string[] = [];
  const samples: { tMs: number; ft: number }[] = [];

  for (let year = fromYear; year <= toYear; year++) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const url = coopsPredictionsUrl({
      stationId,
      beginDate: { year, month: 1, day: 1 },
      rangeHours: isLeap ? 8784 : 8760,
      datum,
      application: 'socal-coastal-data-calibration',
    });
    urls.push(url);

    const payload = await fetchJson(url);
    const yearSeries = parseCoopsSeries(payload, {
      stationId,
      timeZone: 'gmt',
      units: 'english',
      datum,
    });
    samples.push(...yearSeries.samples);
  }

  /*
   * The seam overlaps by exactly one sample, and that is arithmetic rather than
   * a guess. CO-OPS treats `range` as inclusive of both endpoints: measured,
   * begin_date=20240101&range=8760 returns 87,601 samples -- 8760 x 10 + 1 --
   * ending at 2024-12-31 00:00, which is 8760 hours after the start of a 366-day
   * year. So a request covering a whole year ends on the NEXT year's first
   * sample, and consecutive years share it.
   *
   * Deduped before the seam check, not by it: the check's job is to prove the
   * result has no duplicates and no gaps, and a check that also performed the
   * repair could not fail.
   */
  const deduped = dedupeSeam(samples);
  assertNoSeamProblems(deduped, stationId);

  return {
    series: {
      stationId,
      datum,
      units: 'ft',
      timeZone: 'UTC',
      samples: deduped,
      uniformStepMs: 6 * 60_000,
    },
    urls,
  };
}

/**
 * Duplicate timestamps and seam gaps, both fatal.
 *
 * A year boundary is where a concatenated series goes wrong: consecutive
 * requests overlap by one sample -- 31 December 00:00 belongs to the year that
 * ends and the year that begins -- and a duplicate would make findExtrema see a
 * zero-length step. A GAP is worse and quieter: a missing hour at a seam would
 * make dayMinimum return the minimum of a partial day, which is a real-looking
 * number for a day the series does not cover.
 */
function assertNoSeamProblems(samples: readonly { tMs: number }[], stationId: string): void {
  const STEP_MS = 6 * 60_000;
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i]!.tMs - samples[i - 1]!.tMs;
    if (delta === 0) {
      throw new Error(
        `CO-OPS ${stationId}: duplicate timestamp at ${new Date(samples[i]!.tMs).toISOString()}. ` +
          'Consecutive year requests overlap by one sample and the overlap was not removed.',
      );
    }
    if (delta < 0) {
      throw new Error(
        `CO-OPS ${stationId}: timestamps go backwards at ` +
          `${new Date(samples[i]!.tMs).toISOString()}. The years were concatenated out of order.`,
      );
    }
    if (delta !== STEP_MS) {
      throw new Error(
        `CO-OPS ${stationId}: a ${delta / 60_000}-minute step at ` +
          `${new Date(samples[i]!.tMs).toISOString()}, expected 6. The series has a gap, and a ` +
          'gap makes the day minimum a minimum of a partial day.',
      );
    }
  }
}

/** Drop the duplicated first sample of each year before concatenating. */
export function dedupeSeam(
  samples: readonly { tMs: number; ft: number }[],
): { tMs: number; ft: number }[] {
  const out: { tMs: number; ft: number }[] = [];
  for (const sample of samples) {
    const last = out[out.length - 1];
    if (last && last.tMs === sample.tMs) continue;
    out.push(sample);
  }
  return out;
}

/* ===========================================================================
 * Cache
 * ========================================================================= */

/**
 * Raw pulls on disk, keyed by query and pull date.
 *
 * Re-running must not re-hit either source. The directory is gitignored:
 * roughly a third of the corpus is All Rights Reserved or No Derivatives, so it
 * cannot be redistributed. What IS committed is the counts, the queries and the
 * content hash -- everything needed to check a number without republishing the
 * records it came from.
 */
export function cacheKey(url: string, pulledAt: string): string {
  return createHash('sha256').update(`${pulledAt}\n${url}`).digest('hex').slice(0, 16);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function readCache(dir: string, key: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(`${dir}/${key}.json`, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeCache(dir: string, key: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${key}.json`, JSON.stringify(value), 'utf8');
}
