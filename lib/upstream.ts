/**
 * The only module in this app that touches the network.
 *
 * `import 'server-only'` is the enforcement, not a convention: a client
 * component that pulls this in fails the build rather than shipping a NOAA
 * request to a browser. The parsers it calls -- lib/tide.ts and lib/ndbc.ts --
 * are pure and separate, so all the format discipline is unit-tested without a
 * network, and this file is only responsible for fetching, caching, and turning
 * failures into something the UI can disclose.
 *
 * Caching, via `next: { revalidate }`:
 *
 *   Predictions   6 h. Tide predictions are astronomical. They do not change
 *                 between requests at all; the only reason to refetch is to roll
 *                 the window forward as days pass.
 *   Swell         15 min. These buoys publish every 30 min or so, so a 15-minute
 *                 revalidate never serves a reading more than one cycle stale.
 *
 * Failure policy, which follows from the repo's rules rather than from
 * convenience:
 *
 *   Predictions failing is fatal to the grid -- there is nothing to show -- so it
 *   surfaces as an explicit failure panel naming the URL and the error.
 *
 *   Swell failing is not fatal. It becomes an unavailable reading, which drives
 *   the day to `swell-tbd`, which can never render as a pass. Format DRIFT is
 *   also non-fatal to the page but is surfaced as a notice rather than swallowed:
 *   a drifted NDBC layout degrades to "unknown", never to a wrong number.
 */

import 'server-only';

import {
  parseCoopsSeries,
  type CoopsRequestContract,
  type TideSeries,
} from './tide';
import { NdbcDriftError, NdbcNoDataError, parseNdbcRealtime2, type Wvht } from './ndbc';
import { formatLocalDate, type LocalDate } from './time';
import type { BuoyId, Spot, TideStationId } from '@/shared/spots.generated';
import { BUOYS, TIDE_DATUM } from '@/shared/spots.generated';

export const PREDICTIONS_REVALIDATE_SECONDS = 6 * 60 * 60;
export const SWELL_REVALIDATE_SECONDS = 15 * 60;

/**
 * Beyond this, a "current" reading is not current. These buoys publish about
 * every 30 minutes, so three hours means at least five missed cycles -- the buoy
 * is answering but not reporting. Freshness beats status: this is reported as
 * unavailable rather than as a stale number wearing no warning.
 */
export const MAX_SWELL_AGE_MINUTES = 180;

const USER_AGENT =
  'socal-coastal-data/0.1 (+https://github.com/cweber12/socal-coastal-data) tide-window-grid';

/* ===========================================================================
 * CO-OPS predictions
 * ========================================================================= */

const COOPS_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * The request contract, pinned in one place.
 *
 * time_zone=gmt because the payload's timestamps carry no offset and gmt is the
 * one setting under which reading them as UTC is correct. units=english because
 * the payload does not state its unit either. Both are then handed to the parser
 * as declared facts. verify_coastal_apis.py pins the identical values, and its
 * comment records the 7-hour bug that came of getting the first one wrong.
 */
function predictionsUrl(stationId: string, beginDate: LocalDate, rangeHours: number): string {
  const params = new URLSearchParams({
    product: 'predictions',
    application: 'socal-coastal-data-web',
    station: stationId,
    time_zone: 'gmt',
    units: 'english',
    format: 'json',
    datum: TIDE_DATUM,
    begin_date: formatLocalDate(beginDate).replace(/-/g, ''),
    range: String(rangeHours),
  });
  return `${COOPS_BASE}?${params.toString()}`;
}

export class UpstreamError extends Error {
  readonly url: string;
  constructor(message: string, url: string) {
    super(message);
    this.name = 'UpstreamError';
    this.url = url;
  }
}

/**
 * Fetch the 6-minute prediction series for a station.
 *
 * `beginDate` is interpreted by CO-OPS in the requested zone, which is GMT here,
 * so a date means 00:00 UTC on that date. Callers ask for a day of margin either
 * side of the days they intend to evaluate: a window can open before local
 * midnight and the sub-floor excursion walk needs samples on both sides of it.
 */
export async function fetchTideSeries(
  stationId: TideStationId | string,
  beginDate: LocalDate,
  rangeHours: number,
): Promise<TideSeries> {
  const url = predictionsUrl(stationId, beginDate, rangeHours);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: PREDICTIONS_REVALIDATE_SECONDS },
    });
  } catch (cause) {
    throw new UpstreamError(
      `CO-OPS ${stationId}: request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      url,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(`CO-OPS ${stationId}: HTTP ${response.status}`, url);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new UpstreamError(
      `CO-OPS ${stationId}: body was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      url,
    );
  }

  const contract: CoopsRequestContract = {
    stationId: String(stationId),
    timeZone: 'gmt',
    units: 'english',
    datum: TIDE_DATUM,
  };

  try {
    // Note this can throw on a 200: CO-OPS serves {"error":{...}} with HTTP 200,
    // and the parser treats that as the dead response it is.
    return parseCoopsSeries(payload, contract);
  } catch (cause) {
    throw new UpstreamError(cause instanceof Error ? cause.message : String(cause), url);
  }
}

/* ===========================================================================
 * NDBC swell
 * ========================================================================= */

const NDBC_BASE = 'https://www.ndbc.noaa.gov/data/realtime2';

export type SwellReading =
  | ({
      kind: 'ok';
      buoyId: BuoyId;
      buoyName: string;
    } & Wvht)
  | {
      kind: 'unavailable';
      buoyId: BuoyId;
      buoyName: string;
      /** Why there is no reading. Shown to the user, not swallowed. */
      reason: string;
      /** True when the format drifted, which is a bug rather than a quiet buoy. */
      drift: boolean;
    };

/**
 * Fetch one buoy's newest wave height.
 *
 * Never throws. Every failure becomes an `unavailable` reading carrying its
 * reason, because a missing swell must degrade the day to `swell-tbd` rather
 * than take down a grid of eight spots.
 */
export async function fetchSwell(buoyId: BuoyId, nowMs: number): Promise<SwellReading> {
  const buoyName = BUOYS[buoyId]?.name ?? buoyId;
  const url = `${NDBC_BASE}/${buoyId}.txt`;

  const unavailable = (reason: string, drift = false): SwellReading => ({
    kind: 'unavailable',
    buoyId,
    buoyName,
    reason,
    drift,
  });

  // The inventory already knows this one is dead. Say so from the file rather
  // than spending a request to rediscover it.
  const known = BUOYS[buoyId];
  if (known?.status === 'dead') {
    return unavailable(
      `Buoy ${buoyId} is marked dead in spots.json${known.dead_since ? ` (${known.dead_since})` : ''}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: SWELL_REVALIDATE_SECONDS },
    });
  } catch (cause) {
    return unavailable(
      `Request to NDBC ${buoyId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (response.status === 404) {
    // What 46235 does. The station page still serves 200 while realtime2 404s.
    return unavailable(`NDBC ${buoyId} realtime2 returns 404. The buoy is not publishing.`);
  }
  if (!response.ok) {
    return unavailable(`NDBC ${buoyId} returned HTTP ${response.status}.`);
  }

  const text = await response.text();

  let reading: Wvht;
  try {
    reading = parseNdbcRealtime2(text, buoyId, nowMs);
  } catch (cause) {
    if (cause instanceof NdbcDriftError) {
      // Loud, but not fatal to the page. The state becomes swell-tbd and the
      // message is surfaced as a notice, so the format change is visible and the
      // reading is never guessed at.
      return unavailable(cause.message, true);
    }
    if (cause instanceof NdbcNoDataError) {
      return unavailable(cause.message);
    }
    return unavailable(cause instanceof Error ? cause.message : String(cause));
  }

  if (reading.ageMinutes > MAX_SWELL_AGE_MINUTES) {
    return unavailable(
      `NDBC ${buoyId}'s newest wave height is ${Math.round(reading.ageMinutes)} min old, past the ` +
        `${MAX_SWELL_AGE_MINUTES} min limit. Reported as unknown rather than as a current reading.`,
    );
  }

  return { kind: 'ok', buoyId, buoyName, ...reading };
}

/* ===========================================================================
 * Per-spot swell, with the substitution disclosed
 * ========================================================================= */

export interface SpotSwell {
  /** Feet, or null when nothing usable was found. null means unknown, not calm. */
  swellFt: number | null;
  /** The buoy the number actually came from. */
  sourceBuoyId: BuoyId | null;
  sourceBuoyName: string | null;
  observedAtMs: number | null;
  ageMinutes: number | null;
  /**
   * True when wave.primary was not delivering and wave.fallback supplied the
   * number. spots.json's _schema requires the UI to disclose this: a fallback
   * "may be geographically distant".
   */
  substituted: boolean;
  /** The buoy that should have served this spot, when it is not the source. */
  intendedBuoyId: BuoyId | null;
  /** Everything that went wrong on the way, in order. Shown, never swallowed. */
  problems: string[];
  /** True when any attempt hit a format drift, which is a bug to chase. */
  drift: boolean;
}

/**
 * Resolve a spot's swell: primary, then fallback, disclosing a substitution.
 *
 * `wave.intended_primary` is reported alongside so the UI can say the reading is
 * standing in for a dead buoy. Six south-corridor spots carry
 * intended_primary: "46235" and fall back across roughly 15 miles of differing
 * exposure; that is a disclosure the UI owes the reader, not a detail.
 */
export async function resolveSpotSwell(spot: Spot, nowMs: number): Promise<SpotSwell> {
  const problems: string[] = [];
  let drift = false;

  const intendedBuoyId = spot.wave.intended_primary ?? null;

  const empty = (): SpotSwell => ({
    swellFt: null,
    sourceBuoyId: null,
    sourceBuoyName: null,
    observedAtMs: null,
    ageMinutes: null,
    substituted: false,
    intendedBuoyId,
    problems,
    drift,
  });

  if (spot.wave.primary === null && spot.wave.fallback === null) {
    problems.push('This spot has no wave binding, so there is no swell to read.');
    return empty();
  }

  const attempts: { buoyId: BuoyId; isSubstitution: boolean }[] = [];
  if (spot.wave.primary) attempts.push({ buoyId: spot.wave.primary, isSubstitution: false });
  if (spot.wave.fallback && spot.wave.fallback !== spot.wave.primary) {
    attempts.push({ buoyId: spot.wave.fallback, isSubstitution: true });
  }

  for (const attempt of attempts) {
    const reading = await fetchSwell(attempt.buoyId, nowMs);
    if (reading.kind === 'unavailable') {
      problems.push(reading.reason);
      if (reading.drift) drift = true;
      continue;
    }
    return {
      swellFt: reading.swellFt,
      sourceBuoyId: reading.buoyId,
      sourceBuoyName: reading.buoyName,
      observedAtMs: reading.observedAtMs,
      ageMinutes: reading.ageMinutes,
      substituted: attempt.isSubstitution,
      intendedBuoyId,
      problems,
      drift,
    };
  }

  return empty();
}
