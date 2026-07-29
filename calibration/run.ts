/**
 * The calibration entry point.
 *
 *   node calibration/run.ts                 offline, against committed fixtures
 *   node calibration/run.ts --fetch         live, and writes shared/calibration.json
 *
 * Offline is the default deliberately. A pipeline whose only mode reaches the
 * network cannot be run by a reviewer, cannot be run in CI, and cannot be tested
 * without either mocking the world or being flaky. The committed fixtures are a
 * `cc0`/`cc-by`-only capture, so the offline run's NUMBERS are not the published
 * ones -- roughly a tenth of the corpus licences that way -- and it says so in
 * its own header. What it proves is that the pipeline runs end to end and that
 * every stage agrees on shapes.
 *
 * Only `--fetch` writes shared/calibration.json. The committed artifact is the
 * product of a live run against the whole corpus, and a fixture run must never
 * be able to overwrite it with a tenth of the data.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseCoopsSeries, type TideSeries } from '../lib/tide.ts';
import type { LocalDate } from '../lib/time.ts';
import {
  CALIBRATION_VERSION,
  CORPUS_START,
  DISPLAY_TIME_ZONE,
  FIXTURE_CORPUS_START,
  NPS_CABRILLO_BEST_FT,
  RADIUS_KM,
  SENSITIVITY_ACCURACY_M,
  SENSITIVITY_RADII_KM,
} from './src/config.ts';
import {
  contentHash,
  fetchYearSeries,
  parsePull,
  pullSpot,
  readCache,
  writeCache,
  type RawPull,
} from './src/acquire.ts';
import {
  BINS,
  binVisits,
  collapseToVisits,
  placeVisits,
  wilsonInterval,
  amplitudeRatio,
  type CalibrationRecord,
} from './src/join.ts';
import { evaluateRefusals } from './src/refusals.ts';
import {
  accuracyProfile,
  dayNightSplit,
  leaveOneOut,
  obscuringLossesByTaxon,
  sensitivityGrid,
  taxonHeightDistribution,
  timestampQuality,
  windowStability,
  type FilterStage,
} from './src/diagnostics.ts';
import { renderReport } from './src/report.ts';
import type { CalibrationRun, SpotResult } from './src/run-types.ts';
import { MIN_AMPLITUDE_RATIO } from './src/config.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));

const live = process.argv.includes('--fetch');
const CACHE_DIR = `${HERE}cache`;
const FIXTURE_DIR = `${HERE}__fixtures__`;
const OUT_DIR = `${HERE}out`;

/* ===========================================================================
 * Inputs
 * ========================================================================= */

const taxaFile = JSON.parse(
  await readFile(`${HERE}target_taxa.json`, 'utf8'),
) as {
  version: string;
  targets: { taxon_id: number; name: string }[];
  denominator: { taxon_id: number; name: string }[];
};

const spotsFile = JSON.parse(await readFile(`${REPO}shared/spots.json`, 'utf8')) as {
  version: string;
  spots: {
    slug: string;
    name: string;
    lat: number;
    lon: number;
    tide_station: string;
    tidepool_floor_ft: number | null;
  }[];
};

/**
 * The eight spots the grid can evaluate, derived from the file rather than
 * listed. A spot with no floor is not in the grid, so a rate for it would have
 * nothing to sit beside.
 */
const SPOTS = spotsFile.spots.filter((s) => s.tidepool_floor_ft !== null);

const TARGET_IDS = new Set(taxaFile.targets.map((t) => t.taxon_id));
const ALL_IDS = new Set([
  ...taxaFile.targets.map((t) => t.taxon_id),
  ...taxaFile.denominator.map((t) => t.taxon_id),
]);
const TAXON_NAMES = new Map<number, string>(
  [...taxaFile.targets, ...taxaFile.denominator].map((t) => [t.taxon_id, t.name]),
);
const TAXA_WITH_ROLE = [
  ...taxaFile.targets.map((t) => ({ ...t, role: 'target' as const })),
  ...taxaFile.denominator.map((t) => ({ ...t, role: 'denominator' as const })),
];

const NOW_MS = Date.now();
const PULLED_AT = new Date(NOW_MS).toISOString().slice(0, 10);

/*
 * The offline run is one year of the cc-licensed tenth of the corpus. That is
 * not a smaller version of the published answer, it is a different and much
 * thinner corpus, and every number it produces says so.
 */
const CORPUS_FROM = live ? CORPUS_START : FIXTURE_CORPUS_START;
const TIDE_FROM_YEAR = CORPUS_FROM.year;
const TIDE_TO_YEAR = live ? new Date(NOW_MS).getUTCFullYear() : CORPUS_FROM.year;

/*
 * All eight spots share tide station 9410230 today. That is a property of the
 * current contents of spots.json rather than of the corridor, so it is DERIVED
 * and asserted rather than assumed -- and the assertion matters more than usual
 * here. The rate is expressed in 9410230 predicted feet, the same coordinate
 * system lib/windows.ts consumes, so local datum and range error cancels on use.
 * If a spot ever binds to a different station, every derived rate for it is void
 * and this run must stop rather than quietly mix two datums.
 */
const stations = new Set(SPOTS.map((s) => s.tide_station));
if (stations.size !== 1) {
  throw new Error(
    `The eight evaluable spots read ${stations.size} tide stations (${[...stations].join(', ')}). ` +
      'Every rate is expressed in one station\'s predicted feet, and mixing two silently ' +
      'invalidates the calibration. Rework the join before running this.',
  );
}
const TIDE_STATION = [...stations][0]!;
const DATUM = 'MLLW';

/* ===========================================================================
 * Acquisition, live or from fixtures
 * ========================================================================= */

const queries: string[] = [];

async function fetchJsonCached(url: string): Promise<unknown> {
  const key = contentHash(url).slice(0, 16);
  const cached = await readCache(CACHE_DIR, key);
  if (cached !== null) return cached;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'socal-coastal-data/0.1 calibration' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const payload = await response.json();
  await writeCache(CACHE_DIR, key, payload);
  return payload;
}

async function loadPull(spot: (typeof SPOTS)[number]): Promise<RawPull> {
  if (!live) {
    const raw = JSON.parse(
      await readFile(`${FIXTURE_DIR}/inat-${spot.slug}-cc.json`, 'utf8'),
    ) as RawPull;
    return raw;
  }

  const key = contentHash(`pull ${spot.slug} ${PULLED_AT}`).slice(0, 16);
  const cached = (await readCache(CACHE_DIR, key)) as RawPull | null;
  if (cached) return cached;

  process.stderr.write(`  pulling ${spot.slug}...\n`);
  const pull = await pullSpot(
    {
      slug: spot.slug,
      lat: spot.lat,
      lon: spot.lon,
      // The widest radius in the sensitivity grid. The shipped radius is applied
      // in memory, so one pull serves every cell.
      radiusKm: Math.max(...SENSITIVITY_RADII_KM),
      taxonIds: [...ALL_IDS],
      since: CORPUS_FROM,
    },
    PULLED_AT,
  );
  await writeCache(CACHE_DIR, key, pull);
  return pull;
}

async function loadSeries(): Promise<TideSeries> {
  if (!live) {
    const payload = JSON.parse(
      await readFile(`${FIXTURE_DIR}/coops-${TIDE_STATION}-${TIDE_FROM_YEAR}.json`, 'utf8'),
    );
    return parseCoopsSeries(payload, {
      stationId: TIDE_STATION,
      timeZone: 'gmt',
      units: 'english',
      datum: DATUM,
    });
  }

  process.stderr.write(`  fetching ${TIDE_FROM_YEAR}-${TIDE_TO_YEAR} predictions...\n`);
  const { series, urls } = await fetchYearSeries(
    TIDE_STATION,
    DATUM,
    TIDE_FROM_YEAR,
    TIDE_TO_YEAR,
    fetchJsonCached,
  );
  queries.push(...urls);
  return series;
}

/* ===========================================================================
 * The run
 * ========================================================================= */

const series = await loadSeries();
process.stderr.write(
  `  ${series.samples.length} prediction samples, ` +
    `${new Date(series.samples[0]!.tMs).toISOString().slice(0, 10)} to ` +
    `${new Date(series.samples.at(-1)!.tMs).toISOString().slice(0, 10)}\n`,
);

const spotResults: SpotResult[] = [];
let totalRecords = 0;
let totalVisits = 0;

for (const spot of SPOTS) {
  const pull = await loadPull(spot);
  queries.push(pull.firstUrl);

  // Parsed at the WIDEST radius so the sensitivity grid has records to narrow.
  const wide = parsePull(
    pull.results,
    spot,
    Math.max(...SENSITIVITY_RADII_KM),
    NOW_MS,
  );

  const atRadius = wide.records.filter((r) => r.distanceM <= RADIUS_KM * 1000);
  const visits = placeVisits(
    collapseToVisits(atRadius, ALL_IDS, TARGET_IDS),
    series,
    DISPLAY_TIME_ZONE,
  );
  const bins = binVisits(visits);
  const verdict = evaluateRefusals(bins, visits);
  const ratio = amplitudeRatio(bins);

  const filterStages: FilterStage[] = [
    {
      name: 'pulled (research grade, taxa, 1000 m, 2016→)',
      surviving: pull.results.length,
      removed: 0,
      note: `iNaturalist counted ${pull.totalResults} for this query across ${pull.pages} pages`,
    },
    {
      name: 'captive dropped',
      surviving: pull.results.length - wide.exclusions.captive,
      removed: wide.exclusions.captive,
      note: 'filtered in memory, not by the query, so the count is measurable',
    },
    {
      name: 'geoprivacy dropped',
      surviving:
        pull.results.length - wide.exclusions.captive - wide.exclusions.obscured,
      removed: wide.exclusions.obscured,
      note: 'coordinates randomised within ~0.2°, so these can never be placed at a reef',
    },
    {
      name: 'future-dated dropped',
      surviving:
        pull.results.length -
        wide.exclusions.captive -
        wide.exclusions.obscured -
        wide.futureDated,
      removed: wide.futureDated,
      note: '#30 measured zero across every filtered spot-zone; a count of zero is the finding',
    },
    {
      name: 'no usable date or location',
      surviving: wide.records.length + wide.exclusions.outsideRadius,
      removed: wide.exclusions.noObservedOn + wide.exclusions.noLocation,
      note: 'no visit key without a local date; no bin without a coordinate',
    },
    {
      name: `within ${RADIUS_KM * 1000} m`,
      surviving: atRadius.length,
      removed: wide.records.length - atRadius.length,
      note: 'one corridor-wide radius; the wider pull exists only for the sensitivity grid',
    },
    {
      name: 'collapsed to visits',
      surviving: visits.length,
      removed: atRadius.length - visits.length,
      note: 'one visit = one (observer, local day); a filter stage, not a diagnostic',
    },
  ];

  const npsBin = bins.find(
    (b) => NPS_CABRILLO_BEST_FT >= b.loFt && NPS_CABRILLO_BEST_FT < b.hiFt,
  );
  const npsAgreement =
    spot.slug !== 'cabrillo-tidepools'
      ? 'Not applicable: NPS publishes this figure for Cabrillo only.'
      : npsBin === undefined || npsBin.rate === null
        ? 'No usable bin covers 0.7 ft, so the check could not be made this run.'
        : npsBin.rate < (bins[0]?.rate ?? 1) * 0.5
          ? `AGREES in direction: 0.7 ft sits in ${npsBin.label}, where the observed rate is ` +
            `${npsBin.rate.toFixed(2)} — well under the ${(bins[0]?.rate ?? 0).toFixed(2)} of the ` +
            'lowest bin. NPS calls 0.7 ft the threshold of the best opportunity; the record says ' +
            'the rate is already falling by there. Nothing was tuned to produce this.'
          : `DIVERGES: 0.7 ft sits in ${npsBin.label} at an observed rate of ` +
            `${npsBin.rate.toFixed(2)}, which is not meaningfully below the lowest bin's ` +
            `${(bins[0]?.rate ?? 0).toFixed(2)}. Reported as a divergence. Nothing is tuned ` +
            'against this check — it is the only independent one available and tuning consumes it.';

  spotResults.push({
    slug: spot.slug,
    name: spot.name,
    lat: spot.lat,
    lon: spot.lon,
    tideStation: spot.tide_station,
    records: atRadius.length,
    visits: visits.length,
    observers: new Set(visits.map((v) => v.observerLogin)).size,
    bins: bins.map((b) => ({
      index: b.index,
      label: b.label,
      loFt: b.loFt,
      hiFt: b.hiFt,
      visits: b.visits,
      hits: b.hits,
      rate: b.rate,
      usable: b.usable,
      interval: wilsonInterval(b.hits, b.visits),
    })),
    amplitudeRatio: ratio,
    publishes: verdict.publishes,
    criteria: verdict.criteria,
    nullReason: verdict.nullReason,
    filterStages,
    accuracy: accuracyProfile(atRadius),
    taxonHeights: taxonHeightDistribution(visits, TAXA_WITH_ROLE),
    leaveOneOut: leaveOneOut(visits, taxaFile.targets, MIN_AMPLITUDE_RATIO),
    sensitivity: sensitivityGrid(
      wide.records,
      series,
      DISPLAY_TIME_ZONE,
      ALL_IDS,
      TARGET_IDS,
      SENSITIVITY_RADII_KM,
      SENSITIVITY_ACCURACY_M,
    ),
    stability: windowStability(visits),
    timestamps: timestampQuality(visits, series),
    dayNight: dayNightSplit(visits, spot.lat, spot.lon, DISPLAY_TIME_ZONE),
    obscuringLosses: obscuringLossesByTaxon(wide.obscuredRecords, TAXON_NAMES),
    npsAgreement,
    query: pull.firstUrl,
  });

  totalRecords += atRadius.length;
  totalVisits += visits.length;

  process.stderr.write(
    `  ${spot.slug.padEnd(20)} ${String(visits.length).padStart(5)} visits  ` +
      `ratio ${ratio === null ? '  —  ' : ratio.toFixed(2).padStart(5)}  ` +
      `${verdict.publishes ? 'PUBLISH' : 'refuse'}\n`,
  );
}

const run: CalibrationRun = {
  calibrationVersion: CALIBRATION_VERSION,
  taxaVersion: taxaFile.version,
  pulledAt: PULLED_AT,
  source: live ? 'live' : 'committed cc0/cc-by fixtures — NOT the published corpus',
  corpusFrom: `${CORPUS_FROM.year}-01-01`,
  radiusKm: RADIUS_KM,
  tideStation: TIDE_STATION,
  datum: DATUM,
  tideYears: `${TIDE_FROM_YEAR}–${TIDE_TO_YEAR}`,
  totalRecords,
  totalVisits,
  contentHash: contentHash(spotResults.map((s) => s.bins)),
  spots: spotResults,
  queries: [...new Set(queries)],
};

await mkdir(OUT_DIR, { recursive: true });
const reportPath = `${OUT_DIR}/${live ? 'report.md' : 'report.fixtures.md'}`;
await writeFile(reportPath, renderReport(run), 'utf8');
process.stderr.write(`\nWrote ${reportPath}\n`);

if (live) {
  const calibrationJson = {
    _generated: 'GENERATED FILE — written by calibration/run.ts --fetch. Do not edit by hand.',
    _what_this_is:
      'The observed rate at which a recorded visit logged one of the frozen target taxa, ' +
      'binned by that day\'s lowest predicted tide. A count, not a model output. No ecological ' +
      'claim is made and no zonation is asserted.',
    _units:
      'Bin edges are feet above MLLW at station ' +
      `${TIDE_STATION}, the same coordinate system lib/windows.ts consumes. Adding subordinate-` +
      'station offsets would silently invalidate every rate here.',
    version: CALIBRATION_VERSION,
    taxa_version: taxaFile.version,
    spots_version: spotsFile.version,
    pulled_at: PULLED_AT,
    corpus_from: `${CORPUS_FROM.year}-01-01`,
    radius_m: RADIUS_KM * 1000,
    tide_station: TIDE_STATION,
    datum: DATUM,
    tide_years: `${TIDE_FROM_YEAR}-${TIDE_TO_YEAR}`,
    content_hash: run.contentHash,
    bin_edges: BINS.map((b) => b.loFt).concat(BINS.at(-1)!.hiFt),
    constants: {
      usable_bin_min_visits: 15,
      min_usable_bins: 3,
      min_concordant_pairs: 0.7,
      min_amplitude_ratio: MIN_AMPLITUDE_RATIO,
      max_single_observer_share: 0.3,
    },
    queries: run.queries,
    spots: spotResults.map((s) => ({
      slug: s.slug,
      visits: s.visits,
      records: s.records,
      observers: s.observers,
      amplitude_ratio: s.amplitudeRatio,
      published: s.publishes,
      null_reason: s.nullReason,
      bins: s.bins.map((b) => ({
        lo_ft: b.loFt,
        hi_ft: b.hiFt,
        visits: b.visits,
        hits: b.hits,
        rate: b.rate,
        usable: b.usable,
      })),
      query: s.query,
    })),
  };
  await writeFile(
    `${REPO}shared/calibration.json`,
    `${JSON.stringify(calibrationJson, null, 2)}\n`,
    'utf8',
  );
  process.stderr.write('Wrote shared/calibration.json\n');
}
