/**
 * iNaturalist observation parser. Pure: no network, no ambient clock.
 *
 * ---------------------------------------------------------------------------
 * Which API, and why not the one the issue named
 * ---------------------------------------------------------------------------
 *
 * Issue #31 and PRD #30 both specify `api.inaturalist.org/v1/observations` with
 * one corridor-wide bounding box. Measured against both endpoints on
 * 2026-07-28, that combination does not survive contact:
 *
 *   v1, one bbox page, per_page=200     12,028,651 bytes, covering 3 of 14 days
 *   v1 with &fields=id,uri,observed_on     122,928 bytes for 2 records (ignored)
 *   v2 with the same &fields                 3,700 bytes for 3 records
 *
 * v1 serves roughly 75 kB per record and has no field selection -- the `fields`
 * parameter is silently ignored, which is its own small lesson. The corridor
 * bbox holds 2,368 research-grade observations in a 14-day window, so covering
 * the window means twelve pages and ~144 MB.
 *
 * Worse, the bbox is mostly land. Of the newest 200 records only 46 fell within
 * 500 m of any tidepool spot, and 41 of those were Cabrillo -- six of the eight
 * spots got nothing at all. "The newest N in the corridor" is not "the newest N
 * at this reef", and no amount of paging fixes the bias, it only pays for it.
 *
 * So: v2, with an explicit field list, one query per spot on the spot's own
 * `lat`/`lng`/`radius`. Eight requests totalling 142 kB cover every spot's full
 * window completely. That is FEWER requests than paging the bbox, which is the
 * ground the issue chose the bbox on, so the reason for one query survives even
 * though the query itself did not.
 *
 * ---------------------------------------------------------------------------
 * What the payload does and does not tell you
 * ---------------------------------------------------------------------------
 *
 * Measured on 2026-07-28, captured byte-for-byte under __fixtures__:
 *
 *   { "total_results": 95, "page": 1, "per_page": 30, "results": [
 *     { "id": 384748356,
 *       "uri": "https://www.inaturalist.org/observations/384748356",
 *       "observed_on": "2026-07-24",
 *       "time_observed_at": "2026-07-24T12:01:54-07:00",
 *       "location": "32.7198116667,-117.2568583333",
 *       "geoprivacy": null, "taxon_geoprivacy": "open", "obscured": false, ... }]}
 *
 * Four traps, each of which this module refuses to walk into:
 *
 * 1. `time_zone_offset` IS NOT THE OFFSET. v1 serves that field reading
 *    "-08:00" on the very same record whose `time_observed_at` reads
 *    "...T18:10:52-07:00", in July. It is the zone's STANDARD offset, not the
 *    offset in force at the observation. Using it would age every summer
 *    sighting by an hour and put some of them in the wrong local day. It is
 *    deliberately absent from FIELDS below, so it cannot be reached for by
 *    accident, and `time_observed_at` -- which carries a real offset and is
 *    therefore unambiguous -- is the only timestamp read here.
 *
 * 2. `observed_on` IS A DATE WITH NO TIME AND NO ZONE. It is iNaturalist's
 *    idea of the local calendar day. It is kept as a calendar date and never
 *    turned into an instant: midnight-UTC-ing it would move a Pacific evening
 *    sighting to the following day.
 *
 * 3. `location` IS ONE STRING, "lat,lng", not two numbers. And for an OBSCURED
 *    record it is not the real position at all -- iNaturalist randomises it
 *    within a ~0.2 degree cell. Those records are dropped rather than placed,
 *    which is both the privacy answer and the correctness one.
 *
 * 4. A PHOTO'S LICENCE IS THE PHOTO'S, NOT THE OBSERVATION'S. `license_code`
 *    exists at both levels and they can differ. Only the photo's own code
 *    decides whether the photo renders. An unrecognised code withholds the
 *    photo rather than guessing, which is the same refusal rule the unit
 *    strings get elsewhere in this repo.
 *
 * Measured cross-check, held as evidence and NOT as a rule: across 92 photos in
 * the two fixtures, every CC-licensed photo is served from
 * inaturalist-open-data.s3.amazonaws.com and every All-Rights-Reserved one from
 * static.inaturalist.org, with no exceptions. That is iNaturalist's storage
 * architecture showing through, and it agrees with the licence field on every
 * record -- but the licence field remains the authority, because a host name is
 * not a licence grant.
 */

import type { LocalDate } from './time';

/* ===========================================================================
 * The request contract, pinned in one place
 * ========================================================================= */

export const INAT_BASE = 'https://api.inaturalist.org/v2/observations';

/** How far back "recent" reaches. */
export const INAT_WINDOW_DAYS = 14;

/**
 * One corridor-wide radius, in kilometres, matching PRD #30's assignment rule.
 *
 * #30 measured that moving this between 250 m and 1000 m shifts its rates by
 * <=0.02, under a quarter of the sampling interval, which is what licenses a
 * single value rather than eight per-spot ones. Confirmed here from the other
 * side: the furthest unobscured record in the Sunset Cliffs fixture sits at
 * 454 m, so `radius=0.5` is indeed kilometres and iNaturalist is applying it.
 */
export const INAT_RADIUS_KM = 0.5;

/** Records requested per spot. The gallery shows far fewer; see INAT_GALLERY_MAX. */
export const INAT_PER_PAGE = 30;

/**
 * Exactly the fields this module reads, and nothing else.
 *
 * This list is the whole reason v2 is usable: it takes ~75 kB per record down
 * to ~1 kB. It is also a safety property. `time_zone_offset` is not here, and
 * cannot be, so trap 1 above is unreachable rather than merely documented.
 */
export const INAT_FIELDS = [
  'id',
  'uri',
  'observed_on',
  'time_observed_at',
  'location',
  'geoprivacy',
  'taxon_geoprivacy',
  'obscured',
  'captive',
  'quality_grade',
  'license_code',
  'user.login',
  'user.name',
  'taxon.id',
  'taxon.name',
  'taxon.preferred_common_name',
  'taxon.rank',
  'taxon.iconic_taxon_name',
  'photos.id',
  'photos.url',
  'photos.license_code',
  'photos.attribution',
].join(',');

/**
 * What the caller asked iNaturalist for.
 *
 * Declared rather than inferred, in the same shape and for the same reason as
 * `CoopsRequestContract`: the radius and the window are not recoverable from
 * the response body, and the distance guard below cannot run without the
 * centre the query was built around.
 */
export interface InatRequestContract {
  /** The spot the query was centred on. Used only in error messages. */
  spotSlug: string;
  /** Query centre, from shared/spots.json. */
  lat: number;
  lon: number;
  /** The `radius=` value used, in km. */
  radiusKm: number;
  /** The `d1=` value used: the oldest local date the window includes. */
  windowStart: LocalDate;
  /** The `quality_grade=` value used. Only 'research' is accepted. */
  qualityGrade: 'research';
}

/** Build the pinned query for one spot. Shared by the fetch and by its tests. */
export function inatObservationsUrl(contract: InatRequestContract): string {
  const params = new URLSearchParams({
    lat: String(contract.lat),
    lng: String(contract.lon),
    radius: String(contract.radiusKm),
    quality_grade: contract.qualityGrade,
    captive: 'false',
    // Belt. The braces are the client-side exclusions below, which run whatever
    // the server does with these -- an obscured coordinate is randomised, so a
    // leaked record would be placed at a reef it was never seen at.
    geoprivacy: 'open',
    taxon_geoprivacy: 'open',
    d1: formatDateParam(contract.windowStart),
    per_page: String(INAT_PER_PAGE),
    order_by: 'observed_on',
    order: 'desc',
    fields: INAT_FIELDS,
  });
  return `${INAT_BASE}?${params.toString()}`;
}

function formatDateParam(d: LocalDate): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.year}-${p2(d.month)}-${p2(d.day)}`;
}

/* ===========================================================================
 * Types
 * ========================================================================= */

/**
 * The photo licences under which a photo is rendered.
 *
 * Fail closed: anything not on this list withholds the photo. `null` is
 * All Rights Reserved, and any `-nd` code is No Derivatives. Both appear as
 * text entries rather than being dropped -- dropping them would silently select
 * the feed toward observers who happen to license permissively, which is a bias
 * in what the page claims people are seeing.
 */
export const RENDERABLE_PHOTO_LICENCES = [
  'cc0',
  'cc-by',
  'cc-by-nc',
  'cc-by-sa',
  'cc-by-nc-sa',
] as const;

/** Values of `geoprivacy` / `taxon_geoprivacy` that mean the coordinate is not real. */
const WITHHELD_GEOPRIVACY = ['obscured', 'private'];

export interface SightingPhoto {
  id: number;
  /** Rendering URL, ~500 px. See squareToMedium for how it is derived. */
  url: string;
  /** The photo's own licence code, never the observation's. */
  licenceCode: string;
  /** iNaturalist's own credit string, e.g. "(c) morgan, some rights reserved (CC BY-NC)". */
  attribution: string;
}

export interface Sighting {
  id: number;
  /** Canonical observation page. Every rendered photo links back to it. */
  uri: string;
  /** iNaturalist's local calendar date for the observation. Always present. */
  observedOn: LocalDate;
  /**
   * The observation instant, or null when the record carries only a date.
   *
   * Null is unresolved, never midnight. A sighting with no time gets no tide
   * height, because the tide at an unknown hour is not a number anyone should
   * be shown.
   */
  observedAtMs: number | null;
  lat: number;
  lon: number;
  /** Great-circle metres from the spot the query was centred on. */
  distanceM: number;
  observerLogin: string;
  /** The observer's display name when they set one; the login is the fallback. */
  observerName: string | null;
  taxonId: number;
  scientificName: string;
  commonName: string | null;
  taxonRank: string;
  iconicTaxon: string | null;
  /** Null when the photo cannot be rendered, or when there is no photo at all. */
  photo: SightingPhoto | null;
  /** Why there is no photo. Present exactly when `photo` is null. */
  photoWithheldReason: string | null;
  /** How many photos the observation carries, rendered or not. */
  photoCount: number;
}

/** Why records did not survive. Reported, never swallowed. */
export interface InatExclusions {
  /** Geoprivacy or taxon geoprivacy withheld the true coordinate. */
  obscured: number;
  /** `captive: true` survived a `captive=false` request. */
  captive: number;
  /** Not research grade, despite `quality_grade=research`. */
  notResearchGrade: number;
  /** Placed further from the spot than the requested radius. */
  outsideRadius: number;
  /** No usable coordinate at all. */
  noLocation: number;
}

export interface InatObservations {
  contract: InatRequestContract;
  /** iNaturalist's own count for the query, before any client-side exclusion. */
  totalResults: number;
  /** How many records the page carried, before any client-side exclusion. */
  fetchedCount: number;
  /** Survivors, newest first. */
  sightings: Sighting[];
  excluded: InatExclusions;
}

/**
 * The format is not what is pinned above.
 *
 * Distinguished from an exclusion the same way NdbcDriftError is distinguished
 * from NdbcNoDataError: drift is a bug to chase and degrades the section to
 * unavailable, an exclusion is ordinary and is counted.
 */
export class InatDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InatDriftError';
  }
}

/* ===========================================================================
 * Parsing
 * ========================================================================= */

/** `"2026-07-24"`. */
const OBSERVED_ON_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `"2026-07-24T12:01:54-07:00"` or the same with `Z`.
 *
 * The offset is REQUIRED by this pattern. A timestamp without one is on an
 * unknown clock, and `Date.parse` would read it as local -- which on a server in
 * an arbitrary region is the seven-hour bug arriving by a third route.
 */
const TIME_OBSERVED_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `"32.7198116667,-117.2568583333"`. */
const LOCATION_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

/** Every photo URL served in the fixtures ends this way. */
const SQUARE_SUFFIX = '/square.jpg';

/** What SQUARE_SUFFIX is swapped for. ~500 px on the long edge. */
const MEDIUM_SUFFIX = '/medium.jpg';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Swap iNaturalist's 75 px thumbnail URL for its ~500 px one.
 *
 * This is an undocumented URL convention, so it is pinned and it fails soft
 * rather than loudly: the substitution happens ONLY on an exact `/square.jpg`
 * suffix, and anything else is passed through as served. A wrong guess here
 * costs a broken image, which the caller can see; guessing more aggressively
 * would cost every image on the page.
 *
 * Verified on 2026-07-28 -- photo 706970646: square.jpg 200, medium.jpg 200 at
 * 250,285 bytes of image/jpeg.
 */
export function squareToMedium(url: string): string {
  return url.endsWith(SQUARE_SUFFIX)
    ? `${url.slice(0, -SQUARE_SUFFIX.length)}${MEDIUM_SUFFIX}`
    : url;
}

/** Great-circle metres. Haversine on a spherical earth, which is ample at 500 m. */
export function distanceMetres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function assertContract(contract: InatRequestContract): void {
  if (contract.qualityGrade !== 'research') {
    throw new Error(
      `iNaturalist contract: quality_grade must be 'research', got ` +
        `${JSON.stringify(contract.qualityGrade)}. Every displayed identification has to ` +
        'carry community confirmation, because the page tells someone what an animal is.',
    );
  }
  if (!Number.isFinite(contract.lat) || !Number.isFinite(contract.lon)) {
    throw new Error('iNaturalist contract: the query centre must be stated.');
  }
  if (!Number.isFinite(contract.radiusKm) || contract.radiusKm <= 0) {
    throw new Error(
      'iNaturalist contract: radiusKm must be stated. Without it no record can be ' +
        'checked against the distance it was supposedly filtered on.',
    );
  }
}

/**
 * Decide whether a photo may be rendered, and say why when it may not.
 *
 * Returns the reason as prose, because it is shown to a reader rather than
 * logged: a record with a withheld photo still appears, as text.
 */
function classifyPhoto(
  raw: unknown,
  spotSlug: string,
  index: number,
): { photo: SightingPhoto | null; reason: string | null } {
  if (!isRecord(raw)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: a photo entry is not an object.`,
    );
  }
  const { id, url, license_code: licence, attribution } = raw;

  if (typeof id !== 'number' || typeof url !== 'string' || url === '') {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: photo is missing a numeric id or a url. ` +
        `Got id=${JSON.stringify(id)}, url=${JSON.stringify(url)}.`,
    );
  }

  // Null is All Rights Reserved. iNaturalist writes it as an absent code rather
  // than a code meaning "reserved", so the absence is the signal.
  if (licence === null || licence === undefined) {
    return { photo: null, reason: 'All Rights Reserved' };
  }
  if (typeof licence !== 'string') {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: photo license_code is ` +
        `${JSON.stringify(licence)}, neither a string nor null.`,
    );
  }

  const code = licence.toLowerCase();
  if (!(RENDERABLE_PHOTO_LICENCES as readonly string[]).includes(code)) {
    // Covers -nd explicitly and anything new implicitly. An unrecognised licence
    // string is refused rather than interpreted, exactly as an unrecognised unit
    // string is refused elsewhere in this repo.
    return {
      photo: null,
      reason: code.endsWith('-nd') ? 'No Derivatives licence' : `unrecognised licence ${code}`,
    };
  }

  return {
    photo: {
      id,
      url: squareToMedium(url),
      licenceCode: code,
      attribution: typeof attribution === 'string' ? attribution : '',
    },
    reason: null,
  };
}

/**
 * Parse one page of v2 observations for one spot.
 *
 * Two failure modes, kept apart deliberately:
 *
 *   STRUCTURAL DRIFT throws. A missing `results` array, a timestamp with no
 *   offset, a location that is not a coordinate pair -- these mean the payload
 *   is not the thing this parser was written against, and the honest answer is
 *   that the section is unavailable.
 *
 *   POLICY VIOLATIONS are excluded and counted. A record that comes back
 *   obscured, captive or not-research-grade despite the query asking otherwise
 *   is dropped and tallied in `excluded`. It does not throw, because the
 *   consequence of a leaked obscured record is real and the guard should be a
 *   guard rather than a tripwire that takes the whole section down with it.
 */
export function parseInatObservations(
  payload: unknown,
  contract: InatRequestContract,
): InatObservations {
  assertContract(contract);
  const { spotSlug } = contract;

  if (!isRecord(payload)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug}: expected a JSON object, got ${typeof payload}.`,
    );
  }

  const results = payload['results'];
  if (!Array.isArray(results)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug}: no 'results' array in the response. Top-level keys: ` +
        `${Object.keys(payload).join(', ') || '(none)'}.`,
    );
  }

  const totalResults = payload['total_results'];
  if (typeof totalResults !== 'number' || !Number.isFinite(totalResults)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug}: 'total_results' is ${JSON.stringify(totalResults)}, not a ` +
        'number. The count is what the summary line reports, so a missing one would ' +
        'be rendered as zero sightings.',
    );
  }

  const excluded: InatExclusions = {
    obscured: 0,
    captive: 0,
    notResearchGrade: 0,
    outsideRadius: 0,
    noLocation: 0,
  };
  const sightings: Sighting[] = [];
  const radiusM = contract.radiusKm * 1000;

  for (const [index, raw] of results.entries()) {
    if (!isRecord(raw)) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: expected an object, got ${typeof raw}.`,
      );
    }

    /* --- policy, before anything is read out of the record ----------------- */

    if (
      raw['obscured'] === true ||
      WITHHELD_GEOPRIVACY.includes(String(raw['geoprivacy'])) ||
      WITHHELD_GEOPRIVACY.includes(String(raw['taxon_geoprivacy']))
    ) {
      // The coordinate on an obscured record is randomised within a ~0.2 degree
      // cell, so this record cannot be placed at a reef even if we wanted to
      // surface it -- and surfacing it works against the reason it is obscured.
      excluded.obscured++;
      continue;
    }
    if (raw['captive'] === true) {
      excluded.captive++;
      continue;
    }
    if (raw['quality_grade'] !== 'research') {
      excluded.notResearchGrade++;
      continue;
    }

    /* --- structure --------------------------------------------------------- */

    const id = raw['id'];
    if (typeof id !== 'number') {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: id is ${JSON.stringify(id)}, not a number.`,
      );
    }

    const uri = raw['uri'];
    if (typeof uri !== 'string' || !uri.startsWith('https://www.inaturalist.org/observations/')) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: uri is ${JSON.stringify(uri)}, not an ` +
          'inaturalist.org observation URL. Every rendered photo links back through it, ' +
          'so a drifted URL would send readers somewhere unverified.',
      );
    }

    const observedOn = parseObservedOn(raw['observed_on'], spotSlug, index);
    const observedAtMs = parseTimeObserved(raw['time_observed_at'], spotSlug, index);

    const location = raw['location'];
    if (typeof location !== 'string' || location === '') {
      excluded.noLocation++;
      continue;
    }
    const coords = LOCATION_PATTERN.exec(location);
    if (!coords) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: location ${JSON.stringify(location)} does ` +
          'not match the pinned "lat,lng" shape.',
      );
    }
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: location ${JSON.stringify(location)} is out ` +
          'of range, so the two numbers are not the latitude and longitude they claim to be.',
      );
    }

    const distanceM = distanceMetres(contract.lat, contract.lon, lat, lon);
    if (distanceM > radiusM) {
      // Not drift: iNaturalist's own radius filter is what it is, and this is the
      // independent check that the record really belongs to this reef.
      excluded.outsideRadius++;
      continue;
    }

    const user = raw['user'];
    if (!isRecord(user) || typeof user['login'] !== 'string' || user['login'] === '') {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: user.login is missing. Every displayed ` +
          'photo credits its observer, and an uncredited photo is not one this page may show.',
      );
    }

    const taxon = raw['taxon'];
    if (!isRecord(taxon)) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: no taxon object.`,
      );
    }
    const taxonId = taxon['id'];
    const scientificName = taxon['name'];
    const taxonRank = taxon['rank'];
    if (
      typeof taxonId !== 'number' ||
      typeof scientificName !== 'string' ||
      scientificName === '' ||
      typeof taxonRank !== 'string'
    ) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: taxon is missing a numeric id, a name or a ` +
          `rank. Got id=${JSON.stringify(taxonId)}, name=${JSON.stringify(scientificName)}, ` +
          `rank=${JSON.stringify(taxonRank)}.`,
      );
    }

    const photosRaw = raw['photos'];
    if (!Array.isArray(photosRaw)) {
      throw new InatDriftError(
        `iNaturalist ${spotSlug} record ${index}: photos is ${typeof photosRaw}, not an array.`,
      );
    }
    const { photo, reason } =
      photosRaw.length === 0
        ? { photo: null, reason: 'no photo on this observation' }
        : classifyPhoto(photosRaw[0], spotSlug, index);

    const commonName = taxon['preferred_common_name'];
    const iconic = taxon['iconic_taxon_name'];
    const observerName = user['name'];

    sightings.push({
      id,
      uri,
      observedOn,
      observedAtMs,
      lat,
      lon,
      distanceM,
      observerLogin: user['login'],
      observerName: typeof observerName === 'string' && observerName !== '' ? observerName : null,
      taxonId,
      scientificName,
      commonName: typeof commonName === 'string' && commonName !== '' ? commonName : null,
      taxonRank,
      iconicTaxon: typeof iconic === 'string' && iconic !== '' ? iconic : null,
      photo,
      photoWithheldReason: reason,
      photoCount: photosRaw.length,
    });
  }

  return {
    contract,
    totalResults,
    fetchedCount: results.length,
    sightings,
    excluded,
  };
}

function parseObservedOn(raw: unknown, spotSlug: string, index: number): LocalDate {
  if (typeof raw !== 'string') {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: observed_on is ${JSON.stringify(raw)}, not a string.`,
    );
  }
  const m = OBSERVED_ON_PATTERN.exec(raw);
  if (!m) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: observed_on ${JSON.stringify(raw)} does not ` +
        'match the pinned "YYYY-MM-DD" shape.',
    );
  }
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: observed_on ${JSON.stringify(raw)} is not a ` +
        'real calendar date.',
    );
  }
  return date;
}

function parseTimeObserved(raw: unknown, spotSlug: string, index: number): number | null {
  // Absent is ordinary: about 1% of the historical corpus carries a date and no
  // time, per PRD #30. It is unresolved, and stays that way.
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: time_observed_at is ` +
        `${JSON.stringify(raw)}, neither a string nor null.`,
    );
  }
  if (!TIME_OBSERVED_PATTERN.test(raw)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: time_observed_at ${JSON.stringify(raw)} does ` +
        'not carry an explicit UTC offset. Without one the digits are on an unknown clock, ' +
        'and reading them as local time on a server in an arbitrary region shifts the ' +
        'sighting by that server\'s offset.',
    );
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new InatDriftError(
      `iNaturalist ${spotSlug} record ${index}: time_observed_at ${JSON.stringify(raw)} is ` +
        'unparseable.',
    );
  }
  return ms;
}
