/**
 * The iNaturalist parser, against captured payloads.
 *
 * Two fixtures, both byte-for-byte as api.inaturalist.org served them on
 * 2026-07-28:
 *
 *   inat-sunset-cliffs-20260728.json
 *     The production query exactly, geoprivacy filters included. 30 of 95
 *     records. Its photo licences are 16 cc-by, 6 cc-by-nc and 8 All Rights
 *     Reserved, which is what makes the withheld-photo path testable against
 *     real data rather than a hand-built record.
 *
 *   inat-la-jolla-shores-unfiltered-20260728.json
 *     The same query WITHOUT geoprivacy=open&taxon_geoprivacy=open, so it
 *     carries the one genuinely obscured record that query would have removed
 *     -- a Volcano Keyhole Limpet whose coordinate iNaturalist has randomised.
 *     It is here to prove the client-side guard fires on real data instead of
 *     resting on the server having filtered.
 *
 * Everything else -- drifted shapes, empty pages, a timestamp with no offset --
 * is built by mutating a clone of a real record, so each case differs from a
 * known-good payload in exactly the one way under test.
 */

import { describe, expect, it } from 'vitest';

import {
  INAT_FIELDS,
  INAT_PER_PAGE,
  INAT_RADIUS_KM,
  InatDriftError,
  distanceMetres,
  inatObservationsUrl,
  parseInatObservations,
  squareToMedium,
  type InatRequestContract,
} from './inat-observations';
import sunsetCliffs from './__fixtures__/inat-sunset-cliffs-20260728.json';
import laJollaShoresUnfiltered from './__fixtures__/inat-la-jolla-shores-unfiltered-20260728.json';

/** Sunset Cliffs, from shared/spots.json. */
const SUNSET_CLIFFS: InatRequestContract = {
  spotSlug: 'sunset-cliffs',
  lat: 32.723,
  lon: -117.256,
  radiusKm: INAT_RADIUS_KM,
  windowStart: { year: 2026, month: 7, day: 14 },
  qualityGrade: 'research',
};

/** La Jolla Shores, from shared/spots.json. */
const LA_JOLLA_SHORES: InatRequestContract = {
  ...SUNSET_CLIFFS,
  spotSlug: 'la-jolla-shores',
  lat: 32.857,
  lon: -117.257,
};

/** A deep clone, so a mutation in one case cannot leak into the next. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The fixture with its first surviving record replaced by `patch`. */
function withFirstRecord(patch: Record<string, unknown>) {
  const payload = clone(sunsetCliffs) as { results: Record<string, unknown>[] };
  payload.results = [{ ...payload.results[0]!, ...patch }];
  return payload;
}

/* ===========================================================================
 * The request contract
 * ========================================================================= */

describe('inatObservationsUrl', () => {
  it('pins every parameter the payload cannot tell you about', () => {
    const url = new URL(inatObservationsUrl(SUNSET_CLIFFS));

    expect(url.origin + url.pathname).toBe('https://api.inaturalist.org/v2/observations');
    expect(url.searchParams.get('lat')).toBe('32.723');
    expect(url.searchParams.get('lng')).toBe('-117.256');
    expect(url.searchParams.get('radius')).toBe('0.5');
    expect(url.searchParams.get('quality_grade')).toBe('research');
    expect(url.searchParams.get('captive')).toBe('false');
    expect(url.searchParams.get('geoprivacy')).toBe('open');
    expect(url.searchParams.get('taxon_geoprivacy')).toBe('open');
    expect(url.searchParams.get('d1')).toBe('2026-07-14');
    expect(url.searchParams.get('per_page')).toBe(String(INAT_PER_PAGE));
    expect(url.searchParams.get('order_by')).toBe('observed_on');
    expect(url.searchParams.get('order')).toBe('desc');
  });

  it('never asks for time_zone_offset', () => {
    /*
     * v1 serves time_zone_offset as "-08:00" on a July record whose
     * time_observed_at reads "-07:00". It is the zone's STANDARD offset, not
     * the offset in force, and using it would age every summer sighting by an
     * hour. Leaving it out of the field list makes that unreachable rather than
     * merely documented, so the absence is asserted.
     */
    expect(INAT_FIELDS).not.toContain('time_zone_offset');
    expect(INAT_FIELDS).toContain('time_observed_at');
  });

  it('is the URL the fixtures were captured with', () => {
    const url = new URL(inatObservationsUrl(SUNSET_CLIFFS));
    expect(url.searchParams.get('fields')).toBe(INAT_FIELDS);
  });

  it('refuses a contract that does not ask for research grade', () => {
    expect(() =>
      parseInatObservations(sunsetCliffs, {
        ...SUNSET_CLIFFS,
        qualityGrade: 'casual' as unknown as 'research',
      }),
    ).toThrow(/quality_grade must be 'research'/);
  });

  it('refuses a contract with no radius, which is what the distance guard is checked against', () => {
    expect(() =>
      parseInatObservations(sunsetCliffs, { ...SUNSET_CLIFFS, radiusKm: 0 }),
    ).toThrow(/radiusKm must be stated/);
  });
});

/* ===========================================================================
 * A well-formed payload
 * ========================================================================= */

describe('parseInatObservations, on the captured Sunset Cliffs page', () => {
  const parsed = parseInatObservations(sunsetCliffs, SUNSET_CLIFFS);

  it('carries iNaturalist own count separately from what this page holds', () => {
    // 95 in the 14-day window; 30 asked for and 30 served. The summary line
    // reports the first, the gallery draws from the second, and conflating them
    // would understate the record by two thirds.
    expect(parsed.totalResults).toBe(95);
    expect(parsed.fetchedCount).toBe(30);
    expect(parsed.sightings).toHaveLength(30);
  });

  it('reads the timestamp from the offset the payload states', () => {
    const first = parsed.sightings[0]!;
    // "2026-07-24T12:01:54-07:00" -- 19:01:54 UTC. Read as UTC digits it would
    // be seven hours early; read as server-local it would be anything at all.
    expect(first.observedAtMs).toBe(Date.UTC(2026, 6, 24, 19, 1, 54));
    expect(first.observedOn).toEqual({ year: 2026, month: 7, day: 24 });
  });

  it('keeps observed_on as a calendar date rather than an instant', () => {
    // Every observedOn is a plain {year, month, day}. Turning it into an instant
    // would need a zone the field does not carry.
    for (const s of parsed.sightings) {
      expect(Object.keys(s.observedOn).sort()).toEqual(['day', 'month', 'year']);
    }
  });

  it('splits the location string into a coordinate inside the requested radius', () => {
    for (const s of parsed.sightings) {
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lon)).toBe(true);
      expect(s.distanceM).toBeLessThanOrEqual(INAT_RADIUS_KM * 1000);
    }
    // The furthest survivor. Confirms radius=0.5 is kilometres, and that
    // iNaturalist is applying it rather than this guard doing all the work.
    const furthest = Math.max(...parsed.sightings.map((s) => s.distanceM));
    expect(Math.round(furthest)).toBe(454);
  });

  it('excludes nothing from a page the server already filtered', () => {
    expect(parsed.excluded).toEqual({
      obscured: 0,
      captive: 0,
      notResearchGrade: 0,
      outsideRadius: 0,
      noLocation: 0,
    });
  });

  it('renders CC-licensed photos and withholds All Rights Reserved ones as text', () => {
    const rendered = parsed.sightings.filter((s) => s.photo !== null);
    const withheld = parsed.sightings.filter((s) => s.photo === null);

    // 16 cc-by + 6 cc-by-nc rendered, 8 All Rights Reserved withheld.
    expect(rendered).toHaveLength(22);
    expect(withheld).toHaveLength(8);

    // Withheld records are still SIGHTINGS. Dropping them would select the feed
    // toward observers who happen to license permissively.
    for (const s of withheld) {
      expect(s.photoWithheldReason).toBe('All Rights Reserved');
      expect(s.scientificName).not.toBe('');
      expect(s.photoCount).toBeGreaterThan(0);
    }
    for (const s of rendered) {
      expect(s.photoWithheldReason).toBeNull();
      expect(['cc-by', 'cc-by-nc']).toContain(s.photo!.licenceCode);
      expect(s.photo!.attribution).not.toBe('');
    }
  });

  it('points every photo at the medium rendition and every record at its observation page', () => {
    for (const s of parsed.sightings) {
      expect(s.uri).toMatch(/^https:\/\/www\.inaturalist\.org\/observations\/\d+$/);
      if (s.photo) expect(s.photo.url).toMatch(/\/medium\.jpg$/);
    }
  });

  it('credits an observer on every record', () => {
    for (const s of parsed.sightings) {
      expect(s.observerLogin).not.toBe('');
    }
  });
});

/* ===========================================================================
 * Obscured records, against a payload that really contains one
 * ========================================================================= */

describe('geoprivacy', () => {
  it('drops the obscured record the production query would have filtered server-side', () => {
    const parsed = parseInatObservations(laJollaShoresUnfiltered, LA_JOLLA_SHORES);

    // 15 records served, 1 obscured. Its coordinate is randomised within a
    // ~0.2 degree cell, so it cannot be placed at a reef even in principle.
    expect(parsed.fetchedCount).toBe(15);
    expect(parsed.excluded.obscured).toBe(1);
    expect(parsed.sightings).toHaveLength(14);
    expect(parsed.sightings.map((s) => s.scientificName)).not.toContain('Fissurella volcano');
  });

  it('drops a record obscured by taxon geoprivacy as well as by observer geoprivacy', () => {
    const byTaxon = parseInatObservations(
      withFirstRecord({ taxon_geoprivacy: 'obscured' }),
      SUNSET_CLIFFS,
    );
    expect(byTaxon.excluded.obscured).toBe(1);
    expect(byTaxon.sightings).toHaveLength(0);

    const byPrivate = parseInatObservations(
      withFirstRecord({ geoprivacy: 'private' }),
      SUNSET_CLIFFS,
    );
    expect(byPrivate.excluded.obscured).toBe(1);
  });

  it('does not confuse the string "open" with a withheld coordinate', () => {
    // taxon_geoprivacy: "open" is truthy, and a truthiness test here would drop
    // most of the corridor. Every record in the Sunset Cliffs fixture carries
    // either "open" or null.
    const parsed = parseInatObservations(sunsetCliffs, SUNSET_CLIFFS);
    expect(parsed.excluded.obscured).toBe(0);
    expect(parsed.sightings.length).toBeGreaterThan(0);
  });
});

/* ===========================================================================
 * Policy violations are counted, not thrown
 * ========================================================================= */

describe('records the query asked not to receive', () => {
  it('excludes and counts a captive record', () => {
    const parsed = parseInatObservations(withFirstRecord({ captive: true }), SUNSET_CLIFFS);
    expect(parsed.excluded.captive).toBe(1);
    expect(parsed.sightings).toHaveLength(0);
  });

  it('excludes and counts a record that is not research grade', () => {
    const parsed = parseInatObservations(
      withFirstRecord({ quality_grade: 'needs_id' }),
      SUNSET_CLIFFS,
    );
    expect(parsed.excluded.notResearchGrade).toBe(1);
    expect(parsed.sightings).toHaveLength(0);
  });

  it('excludes and counts a record outside the requested radius', () => {
    // Roughly 4 km north of Sunset Cliffs, well outside 500 m.
    const parsed = parseInatObservations(
      withFirstRecord({ location: '32.760,-117.256' }),
      SUNSET_CLIFFS,
    );
    expect(parsed.excluded.outsideRadius).toBe(1);
    expect(parsed.sightings).toHaveLength(0);
  });

  it('excludes and counts a record with no location at all', () => {
    const parsed = parseInatObservations(withFirstRecord({ location: null }), SUNSET_CLIFFS);
    expect(parsed.excluded.noLocation).toBe(1);
    expect(parsed.sightings).toHaveLength(0);
  });
});

/* ===========================================================================
 * Structural drift throws
 * ========================================================================= */

describe('drift', () => {
  it('throws when the results array is missing', () => {
    expect(() => parseInatObservations({ total_results: 3 }, SUNSET_CLIFFS)).toThrow(
      InatDriftError,
    );
    expect(() => parseInatObservations({ total_results: 3 }, SUNSET_CLIFFS)).toThrow(
      /no 'results' array/,
    );
  });

  it('throws when total_results is missing, rather than reporting zero sightings', () => {
    const payload = clone(sunsetCliffs) as Record<string, unknown>;
    delete payload['total_results'];
    expect(() => parseInatObservations(payload, SUNSET_CLIFFS)).toThrow(/total_results/);
  });

  it('throws on a timestamp carrying no UTC offset', () => {
    /*
     * The whole point of pinning this. "2026-07-24 12:01:54" would parse under
     * Date.parse on most engines and land on whatever clock the server happens
     * to run -- the same seven-hour class of bug the CO-OPS parser exists to
     * refuse.
     */
    expect(() =>
      parseInatObservations(
        withFirstRecord({ time_observed_at: '2026-07-24T12:01:54' }),
        SUNSET_CLIFFS,
      ),
    ).toThrow(/does not carry an explicit UTC offset/);
  });

  it('accepts a timestamp offset written as Z', () => {
    const parsed = parseInatObservations(
      withFirstRecord({ time_observed_at: '2026-07-24T19:01:54Z' }),
      SUNSET_CLIFFS,
    );
    expect(parsed.sightings[0]!.observedAtMs).toBe(Date.UTC(2026, 6, 24, 19, 1, 54));
  });

  it('treats an absent timestamp as unresolved rather than as midnight', () => {
    const parsed = parseInatObservations(
      withFirstRecord({ time_observed_at: null }),
      SUNSET_CLIFFS,
    );
    expect(parsed.sightings[0]!.observedAtMs).toBeNull();
    // The date survives, because the record really does carry one.
    expect(parsed.sightings[0]!.observedOn).toEqual({ year: 2026, month: 7, day: 24 });
  });

  it('throws when observed_on has drifted off YYYY-MM-DD', () => {
    expect(() =>
      parseInatObservations(withFirstRecord({ observed_on: '24/07/2026' }), SUNSET_CLIFFS),
    ).toThrow(/pinned "YYYY-MM-DD" shape/);
  });

  it('throws when location is not a coordinate pair', () => {
    expect(() =>
      parseInatObservations(withFirstRecord({ location: 'Sunset Cliffs' }), SUNSET_CLIFFS),
    ).toThrow(/pinned "lat,lng" shape/);
  });

  it('throws when the coordinate is out of range', () => {
    expect(() =>
      parseInatObservations(withFirstRecord({ location: '932.7,-117.2' }), SUNSET_CLIFFS),
    ).toThrow(/out of range/);
  });

  it('throws when the observation URL is not an inaturalist.org observation', () => {
    expect(() =>
      parseInatObservations(
        withFirstRecord({ uri: 'https://example.com/observations/1' }),
        SUNSET_CLIFFS,
      ),
    ).toThrow(/not an inaturalist\.org observation URL/);
  });

  it('throws when the taxon has lost its name or rank', () => {
    expect(() =>
      parseInatObservations(
        withFirstRecord({ taxon: { id: 8021, rank: 'species' } }),
        SUNSET_CLIFFS,
      ),
    ).toThrow(/taxon is missing/);
  });

  it('throws when the observer cannot be credited', () => {
    expect(() =>
      parseInatObservations(withFirstRecord({ user: { id: 1 } }), SUNSET_CLIFFS),
    ).toThrow(/user\.login is missing/);
  });

  it('throws when photos is not an array', () => {
    expect(() =>
      parseInatObservations(withFirstRecord({ photos: null }), SUNSET_CLIFFS),
    ).toThrow(/photos is object, not an array/);
  });
});

/* ===========================================================================
 * An empty page is a fact, not a failure
 * ========================================================================= */

describe('an empty result set', () => {
  it('parses to no sightings and no exclusions', () => {
    const parsed = parseInatObservations(
      { total_results: 0, page: 1, per_page: 30, results: [] },
      SUNSET_CLIFFS,
    );
    expect(parsed.totalResults).toBe(0);
    expect(parsed.fetchedCount).toBe(0);
    expect(parsed.sightings).toEqual([]);
  });
});

/* ===========================================================================
 * Photos
 * ========================================================================= */

describe('photo licences', () => {
  it('withholds a No Derivatives photo and says so', () => {
    const parsed = parseInatObservations(
      withFirstRecord({
        photos: [{ id: 1, url: 'https://x/photos/1/square.jpg', license_code: 'cc-by-nd' }],
      }),
      SUNSET_CLIFFS,
    );
    expect(parsed.sightings[0]!.photo).toBeNull();
    expect(parsed.sightings[0]!.photoWithheldReason).toBe('No Derivatives licence');
  });

  it('withholds a licence code it does not recognise rather than guessing', () => {
    const parsed = parseInatObservations(
      withFirstRecord({
        photos: [{ id: 1, url: 'https://x/photos/1/square.jpg', license_code: 'cc-by-nc-nd-4.1' }],
      }),
      SUNSET_CLIFFS,
    );
    expect(parsed.sightings[0]!.photo).toBeNull();
    expect(parsed.sightings[0]!.photoWithheldReason).toMatch(/unrecognised licence/);
  });

  it('renders cc0', () => {
    const parsed = parseInatObservations(
      withFirstRecord({
        photos: [
          {
            id: 1,
            url: 'https://x/photos/1/square.jpg',
            license_code: 'cc0',
            attribution: 'no rights reserved',
          },
        ],
      }),
      SUNSET_CLIFFS,
    );
    expect(parsed.sightings[0]!.photo!.licenceCode).toBe('cc0');
  });

  it('keeps a record that has no photo at all, with the reason', () => {
    const parsed = parseInatObservations(withFirstRecord({ photos: [] }), SUNSET_CLIFFS);
    expect(parsed.sightings).toHaveLength(1);
    expect(parsed.sightings[0]!.photo).toBeNull();
    expect(parsed.sightings[0]!.photoWithheldReason).toBe('no photo on this observation');
    expect(parsed.sightings[0]!.photoCount).toBe(0);
  });

  it('throws when a photo entry has lost its id or url', () => {
    expect(() =>
      parseInatObservations(
        withFirstRecord({ photos: [{ license_code: 'cc-by' }] }),
        SUNSET_CLIFFS,
      ),
    ).toThrow(/missing a numeric id or a url/);
  });
});

describe('squareToMedium', () => {
  it('substitutes only on an exact /square.jpg suffix', () => {
    expect(squareToMedium('https://x/photos/706970646/square.jpg')).toBe(
      'https://x/photos/706970646/medium.jpg',
    );
  });

  it('passes anything else through as served', () => {
    // An undocumented URL convention fails soft. A wrong guess costs one broken
    // image the caller can see; guessing harder would cost every image.
    for (const url of [
      'https://x/photos/1/square.png',
      'https://x/photos/1/original.jpg',
      'https://x/photos/1',
    ]) {
      expect(squareToMedium(url)).toBe(url);
    }
  });
});

describe('distanceMetres', () => {
  it('is zero at the same point', () => {
    expect(distanceMetres(32.723, -117.256, 32.723, -117.256)).toBe(0);
  });

  it('measures a known separation', () => {
    // Sunset Cliffs to Cabrillo Tidepools, from shared/spots.json. Great-circle
    // distance is about 6.1 km.
    const m = distanceMetres(32.723, -117.256, 32.669, -117.245);
    expect(m).toBeGreaterThan(6_000);
    expect(m).toBeLessThan(6_200);
  });
});
