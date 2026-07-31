/**
 * The sighting-to-tide join, against real predictions.
 *
 * The series is `coops-9410230-20260713-384h.json`, captured byte-for-byte on
 * 2026-07-28: 3,841 six-minute samples from 2026-07-13 00:00 UTC to 2026-07-29
 * 00:00 UTC. That is exactly the window loadSpotGallery requests, so a sighting
 * inside the 14-day feed is inside this series for the same reason it would be
 * in production rather than by a coincidence of test data.
 *
 * The sightings themselves come from the captured Sunset Cliffs page, so the
 * timestamps under test are real observation timestamps and not round numbers
 * chosen to make interpolation easy.
 */

import { describe, expect, it } from 'vitest';

import { parseCoopsSeries, findExtrema, heightAt, type TideSeries } from './feeds/coops-predictions';
import { parseInatObservations, INAT_RADIUS_KM, type Sighting } from './feeds/inat-observations';
import { annotateWithTide, newestSightings, SIGHTINGS_GALLERY_MAX } from './sightings';
import coops384h from './feeds/__fixtures__/coops-9410230-20260713-384h.json';
import sunsetCliffs from './feeds/__fixtures__/inat-sunset-cliffs-20260728.json';

const SERIES: TideSeries = parseCoopsSeries(coops384h, {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
});

const OBSERVATIONS = parseInatObservations(sunsetCliffs, {
  spotSlug: 'sunset-cliffs',
  lat: 32.723,
  lon: -117.256,
  radiusKm: INAT_RADIUS_KM,
  windowStart: { year: 2026, month: 7, day: 14 },
  qualityGrade: 'research',
});

/** A sighting with only the fields the join reads, so a case says what it tests. */
function sightingAt(observedAtMs: number | null, overrides: Partial<Sighting> = {}): Sighting {
  return {
    ...OBSERVATIONS.sightings[0]!,
    observedAtMs,
    ...overrides,
  };
}

describe('annotateWithTide, against the captured 16-day series', () => {
  it('gives every real sighting in the window a height and a distance from the low', () => {
    const annotated = annotateWithTide(OBSERVATIONS.sightings, SERIES);

    expect(annotated).toHaveLength(OBSERVATIONS.sightings.length);
    for (const s of annotated) {
      expect(s.tideUnavailableReason).toBeNull();
      expect(s.tide).not.toBeNull();
      // The corridor's range is under 9 ft. A height outside this would mean the
      // datum or the unit is not what the series declares.
      expect(s.tide!.heightFt).toBeGreaterThan(-3);
      expect(s.tide!.heightFt).toBeLessThan(8);
      // Mixed semidiurnal: no instant is more than about 6 h 13 m from a low.
      expect(Math.abs(s.tide!.minutesFromLow)).toBeLessThanOrEqual(6 * 60 + 30);
    }
  });

  it('reads the height from lib/tide.ts rather than reimplementing it', () => {
    // A second implementation here would be a second answer, and the day chart
    // on the same page draws from the first one.
    const [first] = annotateWithTide([OBSERVATIONS.sightings[0]!], SERIES);
    expect(first!.tide!.heightFt).toBe(heightAt(SERIES, OBSERVATIONS.sightings[0]!.observedAtMs!));
  });

  it('picks the nearest low, not the next one', () => {
    const lows = findExtrema(SERIES).filter((e) => e.kind === 'low');
    const target = lows[5]!;

    // 90 minutes AFTER a low: the nearest low is the one just passed.
    const after = annotateWithTide([sightingAt(target.tMs + 90 * 60_000)], SERIES)[0]!;
    expect(after.tide!.lowMs).toBe(target.tMs);
    expect(after.tide!.minutesFromLow).toBeCloseTo(90, 6);

    // 90 minutes BEFORE it: same low, negative offset.
    const before = annotateWithTide([sightingAt(target.tMs - 90 * 60_000)], SERIES)[0]!;
    expect(before.tide!.lowMs).toBe(target.tMs);
    expect(before.tide!.minutesFromLow).toBeCloseTo(-90, 6);
  });

  it('states no height for a sighting that carries no time', () => {
    // Null is unresolved, never midnight. The tide at an unknown hour of a day
    // whose range is 6 ft is not a number anyone should be shown.
    const [only] = annotateWithTide([sightingAt(null)], SERIES);
    expect(only!.tide).toBeNull();
    expect(only!.tideUnavailableReason).toBe('this observation records a date but no time');
  });

  it('states no height outside the series rather than clamping to its end', () => {
    const beyond = SERIES.samples.at(-1)!.tMs + 60_000;
    const [only] = annotateWithTide([sightingAt(beyond)], SERIES);
    expect(only!.tide).toBeNull();
    expect(only!.tideUnavailableReason).toMatch(/outside the predictions fetched for it/);
  });

  it('renders every sighting with a stated reason when predictions could not be loaded', () => {
    // A failed CO-OPS fetch must not take the gallery down with it.
    const annotated = annotateWithTide(OBSERVATIONS.sightings, null);
    expect(annotated).toHaveLength(OBSERVATIONS.sightings.length);
    for (const s of annotated) {
      expect(s.tide).toBeNull();
      expect(s.tideUnavailableReason).toBe(
        'tide predictions for this window could not be loaded',
      );
    }
  });

  it('never leaves a null tide without a reason', () => {
    for (const series of [SERIES, null]) {
      for (const s of annotateWithTide([sightingAt(null), ...OBSERVATIONS.sightings], series)) {
        expect(s.tide === null).toBe(s.tideUnavailableReason !== null);
      }
    }
  });
});

describe('newestSightings', () => {
  it('orders by the observation instant, not by the date-only field', () => {
    /*
     * The query asks for order_by=observed_on, and observed_on is a date with no
     * time -- so records sharing a day arrive in an order iNaturalist does not
     * define. Two sightings on the same day, six hours apart, must come back
     * newest first.
     */
    const day = Date.UTC(2026, 6, 24, 0, 0, 0);
    const [first, second] = newestSightings([
      sightingAt(day + 6 * 3_600_000, { id: 1 }),
      sightingAt(day + 18 * 3_600_000, { id: 2 }),
    ]);
    expect(first!.id).toBe(2);
    expect(second!.id).toBe(1);
  });

  it('falls back to the calendar date for a record with no time', () => {
    const withTime = sightingAt(Date.UTC(2026, 6, 20, 12, 0, 0), {
      id: 1,
      observedOn: { year: 2026, month: 7, day: 20 },
    });
    const dateOnly = sightingAt(null, { id: 2, observedOn: { year: 2026, month: 7, day: 25 } });
    // The dated-only record is genuinely newer and must not sort last just for
    // lacking a time.
    expect(newestSightings([withTime, dateOnly])[0]!.id).toBe(2);
  });

  it('caps the gallery without preferring records whose photo happens to render', () => {
    const shown = newestSightings(OBSERVATIONS.sightings, SIGHTINGS_GALLERY_MAX);
    expect(shown).toHaveLength(SIGHTINGS_GALLERY_MAX);

    /*
     * The Sunset Cliffs page's 30 records are 22 renderable and 8 All Rights
     * Reserved. Selection is by recency alone, so the first six are whatever the
     * first six are -- and they must be exactly the first six of the full
     * recency ordering, not the first six that carry a usable photo.
     */
    const byRecency = newestSightings(OBSERVATIONS.sightings, OBSERVATIONS.sightings.length);
    expect(shown.map((s) => s.id)).toEqual(byRecency.slice(0, SIGHTINGS_GALLERY_MAX).map((s) => s.id));
  });
});
