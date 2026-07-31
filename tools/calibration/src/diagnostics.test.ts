/**
 * The diagnostics.
 *
 * Two of these are load-bearing rather than informational, and both are tested
 * against cases where a broken implementation would look plausible:
 *
 *   The leave-one-out table is what makes LIST LENGTH visible. Its key property
 *   is that removing a target can only ever lower the hit count, because the
 *   label is an OR -- so a run whose Δ hits was ever positive would mean the
 *   label is not what it claims to be.
 *
 *   The per-taxon height distribution is the contamination detector a human
 *   reads. It has to resolve a genus target through ancestry or it reports the
 *   genus as absent, which is exactly the failure it exists to catch.
 */

import { describe, expect, it } from 'vitest';

import { parseCoopsSeries, type TideSeries } from '../../../lib/tide.ts';
import { distanceMetres } from '../../../lib/inat.ts';
import {
  accuracyProfile,
  centringDiagnostic,
  compassPoint,
  dayNightSplit,
  leaveOneOut,
  obscuringLossesByTaxon,
  offsetCentre,
  percentile,
  sensitivityGrid,
  taxonHeightDistribution,
  timestampQuality,
  windowStability,
} from './diagnostics.ts';
import {
  collapseToVisits,
  placeVisits,
  type CalibrationRecord,
  type PlacedVisit,
} from './join.ts';
import coops2026 from '../__fixtures__/coops-9410230-2026.json' with { type: 'json' };

const SERIES: TideSeries = parseCoopsSeries(coops2026, {
  stationId: '9410230',
  timeZone: 'gmt',
  units: 'english',
  datum: 'MLLW',
});

const TZ = 'America/Los_Angeles';
const CABRILLO = { lat: 32.669, lon: -117.245 };

const MEGATHURA = 48645;
const APLYSIA = 48655;
const PHYLLOSPADIX = 72297;
const ANTHOPLEURA = 49051;

const TARGETS = [
  { taxon_id: MEGATHURA, name: 'Megathura crenulata' },
  { taxon_id: APLYSIA, name: 'Aplysia californica' },
  { taxon_id: PHYLLOSPADIX, name: 'Phyllospadix' },
];
const TARGET_IDS = new Set(TARGETS.map((t) => t.taxon_id));
const ALL_IDS = new Set([...TARGET_IDS, ANTHOPLEURA]);

let nextId = 1;
function record(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    id: nextId++,
    observerLogin: `observer-${nextId}`,
    observedOn: { year: 2026, month: 7, day: 15 },
    observedAtMs: Date.UTC(2026, 6, 15, 20, 0, 0),
    lat: CABRILLO.lat,
    lon: CABRILLO.lon,
    distanceM: 100,
    positionalAccuracyM: 20,
    taxonId: ANTHOPLEURA,
    ancestorIds: [ANTHOPLEURA],
    ...over,
  };
}

const place = (records: CalibrationRecord[]): PlacedVisit[] =>
  placeVisits(collapseToVisits(records, ALL_IDS, TARGET_IDS), SERIES, TZ);

/**
 * A day whose local low is under -1.0 ft, and one whose local low is over
 * +1.0 ft, both found in the real 2026 series rather than guessed.
 *
 * Picked by search so the cases below cannot quietly stop testing what they
 * claim if the fixture is ever recaptured for another year: a hardcoded date
 * that drifted into the wrong bin would leave the test green and meaningless.
 */
function findDayWithLow(predicate: (ft: number) => boolean): { year: number; month: number; day: number } {
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= 28; day++) {
      const start = Date.UTC(2026, month - 1, day, 8);
      const end = start + 23 * 3_600_000;
      let low = Infinity;
      for (const s of SERIES.samples) {
        if (s.tMs < start) continue;
        if (s.tMs >= end) break;
        if (s.ft < low) low = s.ft;
      }
      if (Number.isFinite(low) && predicate(low)) return { year: 2026, month, day };
    }
  }
  throw new Error('no day in the 2026 fixture matches; the fixture or the predicate is wrong');
}

const LOW_DAY = findDayWithLow((ft) => ft < -1.0);
const HIGH_DAY = findDayWithLow((ft) => ft >= 1.0 && ft < 3.0);

/* ===========================================================================
 * Percentiles
 * ========================================================================= */

describe('percentile', () => {
  it('interpolates between samples', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 1, 2, 3, 4], 0.25)).toBe(1);
  });

  it('is null on an empty sample rather than zero', () => {
    // Zero is a height. "No records" is not, and the two must not render alike.
    expect(percentile([], 0.5)).toBeNull();
  });

  it('handles a single value', () => {
    expect(percentile([2.5], 0.9)).toBe(2.5);
  });
});

/* ===========================================================================
 * Accuracy, reported not filtered
 * ========================================================================= */

describe('accuracyProfile', () => {
  it('counts null and imprecise separately, because acc_below conflates them', () => {
    const profile = accuracyProfile([
      record({ positionalAccuracyM: null }),
      record({ positionalAccuracyM: null }),
      record({ positionalAccuracyM: 500 }),
      record({ positionalAccuracyM: 10 }),
    ]);
    expect(profile.nullAccuracy).toBe(2);
    expect(profile.imprecise).toBe(1);
    expect(profile.precise).toBe(1);
    expect(profile.nullFraction).toBe(0.5);
    expect(profile.impreciseFraction).toBe(0.25);
  });

  it('treats exactly 100 m as precise, not imprecise', () => {
    expect(accuracyProfile([record({ positionalAccuracyM: 100 })]).imprecise).toBe(0);
  });

  it('does not divide by zero on no records', () => {
    expect(accuracyProfile([]).nullFraction).toBe(0);
  });
});

/* ===========================================================================
 * Per-taxon height distribution
 * ========================================================================= */

describe('taxonHeightDistribution', () => {
  it('resolves a genus target through ancestry rather than reporting it absent', () => {
    // P. torreyi records must count toward the Phyllospadix row. On raw taxon.id
    // the genus would read zero visits, and its removal would look costless.
    const rows = taxonHeightDistribution(
      place([
        record({ taxonId: 72298, ancestorIds: [47126, PHYLLOSPADIX, 72298] }),
        record({ taxonId: 72299, ancestorIds: [47126, PHYLLOSPADIX, 72299] }),
      ]),
      [{ taxon_id: PHYLLOSPADIX, name: 'Phyllospadix', role: 'target' }],
    );
    expect(rows[0]!.visits).toBe(2);
    expect(rows[0]!.medianFt).not.toBeNull();
  });

  it('sorts by median so a contaminated taxon stands out at the bottom', () => {
    /*
     * The diver signature. One taxon recorded only on high-tide days sorts to
     * the end of the table, which is what makes it visible without anyone
     * having to interpret a number.
     */
    const low = LOW_DAY;
    const high = HIGH_DAY;

    const rows = taxonHeightDistribution(
      place([
        record({ observedOn: low, taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
        record({ observedOn: low, taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
        record({ observedOn: high, taxonId: APLYSIA, ancestorIds: [APLYSIA] }),
        record({ observedOn: high, taxonId: APLYSIA, ancestorIds: [APLYSIA] }),
      ]),
      [
        { taxon_id: MEGATHURA, name: 'Megathura crenulata', role: 'target' },
        { taxon_id: APLYSIA, name: 'Aplysia californica', role: 'target' },
      ],
    );
    expect(rows[0]!.medianFt!).toBeLessThan(rows[1]!.medianFt!);
  });

  it('reports a taxon with no visits as null rather than zero feet', () => {
    const rows = taxonHeightDistribution(place([record()]), [
      { taxon_id: MEGATHURA, name: 'Megathura crenulata', role: 'target' },
    ]);
    expect(rows[0]!.visits).toBe(0);
    expect(rows[0]!.medianFt).toBeNull();
  });
});

/* ===========================================================================
 * Leave one out
 * ========================================================================= */

describe('leaveOneOut', () => {
  it('never raises the hit count, because the label is an OR', () => {
    /*
     * The property that makes the table meaningful. Adding a taxon can only
     * raise the rate and removing one can only lower it, so "no change is
     * justified by turning more cells green" can be satisfied silently by
     * lengthening the list -- and this table is what makes that visible. A run
     * with a positive Δ would mean the label is not the OR it claims to be.
     */
    const records = [
      record({ taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
      record({ taxonId: APLYSIA, ancestorIds: [APLYSIA] }),
      record({ taxonId: 72298, ancestorIds: [PHYLLOSPADIX, 72298] }),
      record(),
    ];
    for (const row of leaveOneOut(place(records), TARGETS, 2)) {
      expect(row.hitsDelta).toBeLessThanOrEqual(0);
    }
  });

  it('attributes the loss to the taxon that was carrying it', () => {
    // Three visits recorded Megathura and nothing else recorded a target.
    const records = [
      record({ observerLogin: 'a', taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
      record({ observerLogin: 'b', taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
      record({ observerLogin: 'c', taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
      record({ observerLogin: 'd' }),
    ];
    const rows = leaveOneOut(place(records), TARGETS, 2);

    expect(rows.find((r) => r.removedTaxonId === MEGATHURA)!.hitsDelta).toBe(-3);
    expect(rows.find((r) => r.removedTaxonId === APLYSIA)!.hitsDelta).toBe(0);
  });

  it('does not double-count a visit that recorded two targets', () => {
    // One visit, two targets. Removing either leaves the visit a hit.
    const records = [
      record({ observerLogin: 'a', taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
      record({ observerLogin: 'a', taxonId: APLYSIA, ancestorIds: [APLYSIA] }),
    ];
    const rows = leaveOneOut(place(records), TARGETS, 2);
    expect(rows.find((r) => r.removedTaxonId === MEGATHURA)!.hitsDelta).toBe(0);
  });

  it('flags a removal that flips the verdict', () => {
    /*
     * The finding #30 reported for Megathura: one taxon carrying the whole
     * result. Built as a spot that CLEARS a gate of 2.0 and stops clearing it
     * when Megathura is removed -- which means the baseline has to pass first,
     * so the high bin needs a nonzero background rate to be a ratio against.
     *
     *   low bin   30 of 40 hit, every one via Megathura        -> 0.75
     *   high bin   8 of 40 hit, four Aplysia and four Phyllospadix -> 0.20
     *   ratio 3.75, over the gate.
     *
     * Remove Megathura and the low bin goes to 0.00 while the high bin holds at
     * 0.20. The spot stops publishing on the strength of one species.
     *
     * The background is split across TWO taxa deliberately. With all eight high-
     * bin hits on Aplysia, removing Aplysia would empty the highest bin and make
     * the ratio uncomputable -- which is also a flip, but for the opposite
     * reason, and it would leave this case unable to show that the flag is
     * specific to the taxon carrying the SIGNAL.
     */
    const records: CalibrationRecord[] = [];
    for (let i = 0; i < 40; i++) {
      const hit = i < 30;
      records.push(
        record({
          observerLogin: `low-${i}`,
          observedOn: LOW_DAY,
          taxonId: hit ? MEGATHURA : ANTHOPLEURA,
          ancestorIds: [hit ? MEGATHURA : ANTHOPLEURA],
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      const taxon = i < 4 ? APLYSIA : i < 8 ? PHYLLOSPADIX : ANTHOPLEURA;
      records.push(
        record({
          observerLogin: `high-${i}`,
          observedOn: HIGH_DAY,
          taxonId: taxon,
          ancestorIds: [taxon],
        }),
      );
    }

    const placed = place(records);
    // The two groups must land in different bins or the case tests nothing.
    expect(new Set(placed.map((v) => v.binIndex)).size).toBe(2);

    const rows = leaveOneOut(placed, TARGETS, 2);
    expect(rows.find((r) => r.removedTaxonId === MEGATHURA)!.flipsVerdict).toBe(true);
    // Aplysia carries the background, not the signal, so its removal does not flip.
    expect(rows.find((r) => r.removedTaxonId === APLYSIA)!.flipsVerdict).toBe(false);
  });
});

/* ===========================================================================
 * Sensitivity grid
 * ========================================================================= */

describe('sensitivityGrid', () => {
  it('narrows by radius in memory, so every cell comes from one record set', () => {
    const records = [
      record({ observerLogin: 'near', distanceM: 200 }),
      record({ observerLogin: 'mid', distanceM: 400 }),
      record({ observerLogin: 'far', distanceM: 900 }),
    ];
    const cells = sensitivityGrid(records, SERIES, TZ, ALL_IDS, TARGET_IDS, [0.25, 0.5, 1.0], [null]);

    expect(cells.map((c) => c.visits)).toEqual([1, 2, 3]);
  });

  it('applies the accuracy bar to records before collapsing, not to visits after', () => {
    /*
     * A bar applied after collapsing would keep a visit alive on the strength of
     * one imprecise record, which is not what an accuracy filter means. Here one
     * observer has a precise record and an imprecise one on the same day, and a
     * second observer has only an imprecise one -- so the 100 m bar must leave
     * exactly one visit.
     */
    const day = { year: 2026, month: 7, day: 15 };
    const records = [
      record({ observerLogin: 'a', observedOn: day, positionalAccuracyM: 10 }),
      record({ observerLogin: 'a', observedOn: day, positionalAccuracyM: 900 }),
      record({ observerLogin: 'b', observedOn: day, positionalAccuracyM: 900 }),
    ];
    const cells = sensitivityGrid(records, SERIES, TZ, ALL_IDS, TARGET_IDS, [1.0], [null, 100]);

    expect(cells[0]!.visits).toBe(2);
    expect(cells[1]!.visits).toBe(1);
  });

  it('drops a record with no stated accuracy under a bar, because a bar cannot judge it', () => {
    const cells = sensitivityGrid(
      [record({ positionalAccuracyM: null })],
      SERIES,
      TZ,
      ALL_IDS,
      TARGET_IDS,
      [1.0],
      [null, 100],
    );
    expect(cells[0]!.visits).toBe(1);
    expect(cells[1]!.visits).toBe(0);
  });
});

/* ===========================================================================
 * Centring
 * ========================================================================= */

const PIN = CABRILLO;

/** A record at a stated offset from the pin, with its distance measured not assumed. */
function at(eastM: number, northM: number, over: Partial<CalibrationRecord> = {}) {
  const centre = offsetCentre(PIN.lat, PIN.lon, eastM, northM);
  return record({
    lat: centre.lat,
    lon: centre.lon,
    distanceM: distanceMetres(PIN.lat, PIN.lon, centre.lat, centre.lon),
    ...over,
  });
}

const centring = (
  records: CalibrationRecord[],
  options: Partial<Parameters<typeof centringDiagnostic>[4]> = {},
) =>
  centringDiagnostic(records, PIN, ALL_IDS, TARGET_IDS, {
    discRadiusM: 500,
    pullRadiusM: 1000,
    ...options,
  });

describe('offsetCentre', () => {
  /*
   * The one property that matters: the sphere this generates offsets on must be
   * the sphere lib/inat.ts measures distances on. A centre generated on one and
   * measured on the other sits somewhere other than where the diagnostic says,
   * and every count in the grid is a count of the wrong disc. Asserted as a
   * round trip rather than by comparing two copies of a constant, because that
   * is the failure, not the mismatch.
   */
  it('offsets by a distance distanceMetres agrees with', () => {
    for (const [eastM, northM, expected] of [
      [0, 250, 250],
      [250, 0, 250],
      [-500, 0, 500],
      [0, -500, 500],
      [500, 500, Math.hypot(500, 500)],
    ] as const) {
      const p = offsetCentre(PIN.lat, PIN.lon, eastM, northM);
      expect(distanceMetres(PIN.lat, PIN.lon, p.lat, p.lon)).toBeCloseTo(expected, 1);
    }
  });

  it('puts north at higher latitude and east at higher longitude', () => {
    expect(offsetCentre(PIN.lat, PIN.lon, 0, 250).lat).toBeGreaterThan(PIN.lat);
    expect(offsetCentre(PIN.lat, PIN.lon, 250, 0).lon).toBeGreaterThan(PIN.lon);
  });

  it('corrects east for the latitude, which at 33°N is a 16% correction', () => {
    // Dividing by the equatorial value instead would land ~84 m short of 500 m.
    const p = offsetCentre(PIN.lat, PIN.lon, 500, 0);
    expect(distanceMetres(PIN.lat, PIN.lon, p.lat, p.lon)).toBeGreaterThan(499);
  });
});

describe('compassPoint', () => {
  it('labels the sixteen points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(315)).toBe('NW');
    expect(compassPoint(337.5)).toBe('NNW');
  });

  it('wraps rather than falling off the end of the table', () => {
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(360)).toBe('N');
  });
});

describe('centringDiagnostic', () => {
  it('reproduces the shipped disc exactly at the pin cell', () => {
    /*
     * The pin cell IS the shipped disc, and if it were not the whole table would
     * be comparing offsets against something the pipeline never computed. The
     * 499/501 pair is the edge the two rules would disagree on first.
     */
    const records = [at(0, 0), at(0, 499), at(0, 501), at(900, 0)];
    const c = centring(records);

    expect(c.pin.records).toBe(records.filter((r) => r.distanceM <= 500).length);
    expect(c.pin.records).toBe(2);
    expect(c.pin.offsetM).toBe(0);
    expect(c.pin.bearingDeg).toBeNull();
    expect(c.pin.compass).toBeNull();
  });

  it('counts records within the near-pin probe separately, as records', () => {
    const c = centring([at(0, 0), at(0, 50), at(0, 300)]);
    expect(c.recordsNearPin).toBe(2);
    expect(c.nearPinRadiusM).toBe(100);
  });

  it('searches a disc of centres, never a square, so no cell reaches past the pull', () => {
    const c = centring([at(0, 0)]);

    for (const cell of c.cells) {
      expect(cell.offsetM).toBeLessThanOrEqual(c.maxOffsetM);
      // The whole point: a disc at this centre is entirely inside the pull, so
      // its count is a measurement rather than a truncation.
      expect(cell.offsetM + c.discRadiusM).toBeLessThanOrEqual(c.pullRadiusM);
    }
    // The square's corner would sit at 707 m and hang 207 m outside the pull.
    expect(c.cells.some((cell) => cell.eastM === 500 && cell.northM === 500)).toBe(false);
    expect(c.cells.some((cell) => cell.eastM === 500 && cell.northM === 0)).toBe(true);
    expect(c.maxOffsetM).toBe(500);
  });

  it('calls a spot centred when the pin already holds the records', () => {
    const c = centring([at(0, 0), at(0, 20), at(20, 0), at(-20, 0), at(0, -20)]);

    expect(c.bestByRecords.offsetM).toBe(0);
    expect(c.recordsRatio).toBe(1);
    expect(c.centred).toBe(true);
    // Every neighbour of the pin was searched, so this is a grid-local optimum
    // rather than the edge of what was looked at.
    expect(c.onSearchBoundary).toBe(false);
  });

  it('finds an off-centre cluster the shipped disc misses, and says it is off-centre', () => {
    const records = [at(0, 0), at(10, 0), ...Array.from({ length: 20 }, () => at(500, 500))];
    const c = centring(records);

    expect(c.pin.records).toBe(2);
    expect(c.bestByRecords.records).toBe(22);
    expect(c.recordsRatio).toBe(11);
    expect(c.centred).toBe(false);
    // The cluster is north-east, so the best centre must be too. Which of the
    // several centres that reach it wins is decided by the tie-break -- nearest
    // the pin -- so the quadrant is the claim, not the exact cell.
    expect(c.bestByRecords.eastM).toBeGreaterThan(0);
    expect(c.bestByRecords.northM).toBeGreaterThan(0);
    expect(c.bestByRecords.bearingDeg).toBeGreaterThan(0);
    expect(c.bestByRecords.bearingDeg).toBeLessThan(90);
    // The nearest centre that reaches the cluster, not the furthest one that does.
    expect(c.bestByRecords.offsetM).toBeLessThan(c.maxOffsetM);
    expect(c.onSearchBoundary).toBe(false);
  });

  it('flags a best offset the grid could not step outward from', () => {
    /*
     * The column that decides what the ratio is worth. All five of #81's
     * refusing spots put their best disc on their grid's boundary, which makes
     * every one of those ratios a lower bound; a diagnostic that reported the
     * ratio without the flag would be worse than none.
     */
    const c = centring([at(10, 0), at(10, 10), ...Array.from({ length: 20 }, () => at(900, 0))]);

    expect(c.bestByRecords.eastM).toBe(500);
    expect(c.bestByRecords.northM).toBe(0);
    expect(c.bestByRecords.records).toBe(22);
    expect(c.onSearchBoundary).toBe(true);
    expect(c.bestByRecords.compass).toBe('E');
  });

  it('gives a tie to the disc nearest the pin', () => {
    // Two discs holding the same records is not evidence that the disc should
    // move, so the pin keeps it and the spot is not reported off-centre.
    const c = centring([at(0, 0), at(0, 10), at(0, -10)]);
    expect(c.bestByRecords.offsetM).toBe(0);
    expect(c.centred).toBe(true);
  });

  it('decides `centred` against the stated bar and nothing else', () => {
    const pinRecords = () => Array.from({ length: 10 }, () => at(10, 0));
    // One extra record reachable only from an offset centre is exactly 1.1x.
    const atBar = centring([...pinRecords(), at(700, 0)]);
    const overBar = centring([...pinRecords(), at(700, 0), at(700, 10)]);

    expect(atBar.recordsRatio).toBeCloseTo(1.1, 10);
    expect(atBar.centred).toBe(true);
    expect(overBar.recordsRatio).toBeCloseTo(1.2, 10);
    expect(overBar.centred).toBe(false);
    expect(atBar.materialRatio).toBe(1.1);
  });

  it('reports visits by the pipeline\'s own collapse, not as a second count', () => {
    /*
     * Counts are not visits. #81's figures came from count queries that skip
     * every in-memory filter, and a diagnostic that presented a count where the
     * pipeline reports a visit would be reporting a different quantity under the
     * same word. Thirty records from one observer on one day are one visit.
     */
    const day = { year: 2026, month: 7, day: 15 };
    const c = centring(
      Array.from({ length: 30 }, () => at(10, 0, { observerLogin: 'one-walk', observedOn: day })),
    );

    expect(c.pin.records).toBe(30);
    expect(c.pin.visits).toBe(1);
  });

  it('lets the richest disc by visits differ from the richest by records', () => {
    /*
     * More records is not automatically more visits, and beach-level slugs cover
     * several benches -- so the two bests are carried separately rather than one
     * standing in for the other.
     */
    const day = { year: 2026, month: 7, day: 15 };
    const records = [
      at(10, 0),
      // A photo-heavy walk east: many records, one visit.
      ...Array.from({ length: 12 }, () => at(700, 0, { observerLogin: 'walker', observedOn: day })),
      // Six separate people west: fewer records, more visits.
      ...Array.from({ length: 6 }, () => at(-700, 0)),
    ];
    const c = centring(records);

    expect(c.bestByRecords.eastM).toBeGreaterThan(0);
    expect(c.bestByVisits.eastM).toBeLessThan(0);
    expect(c.bestByVisits.visits).toBe(7);
  });

  it('is null-safe on an empty record set rather than dividing by zero', () => {
    const c = centring([]);
    expect(c.pin.records).toBe(0);
    expect(c.recordsRatio).toBeNull();
    expect(c.visitsRatio).toBeNull();
    // Nothing anywhere beats nothing at the pin.
    expect(c.centred).toBe(true);
  });

  it('refuses to search a grid the pull cannot cover', () => {
    /*
     * A disc offset further than pull minus radius hangs outside the records
     * that were pulled, and its count would be a truncation reported as a
     * measurement. Rather than caveat that, there is no grid.
     */
    expect(() => centring([at(0, 0)], { pullRadiusM: 550 })).toThrow(/truncated disc/);
  });

  it('never computes a rate, because that would answer a question it cannot', () => {
    /*
     * Whether a refusal survives a recentred disc needs a centre somebody can
     * defend, which is a join against an authority. The guard is structural: the
     * diagnostic takes no tide series, so it cannot bin anything.
     */
    const c = centring([at(0, 0)]);
    expect(Object.keys(c)).not.toContain('bins');
    expect(Object.keys(c)).not.toContain('amplitudeRatio');
  });
});

/* ===========================================================================
 * Window stability
 * ========================================================================= */

describe('windowStability', () => {
  it('reports each window and the full one', () => {
    const rows = windowStability(place([record()]), [null, 2019, 2021, 2023]);
    expect(rows.map((r) => r.fromYear)).toEqual([null, 2019, 2021, 2023]);
    expect(rows[0]!.visits).toBe(1);
  });

  it('does not indict a spot on a slice that merely thinned out', () => {
    /*
     * A bin that drops to three visits will sit outside any interval, and that
     * is a statement about the slice's size rather than about the spot. Only
     * bins usable in BOTH windows are judged.
     */
    const records: CalibrationRecord[] = [];
    for (let i = 0; i < 40; i++) {
      records.push(
        record({
          observerLogin: `o-${i}`,
          observedOn: LOW_DAY,
          taxonId: i % 2 === 0 ? MEGATHURA : ANTHOPLEURA,
          ancestorIds: [i % 2 === 0 ? MEGATHURA : ANTHOPLEURA],
        }),
      );
    }
    // A window that keeps nothing at all cannot be "unstable".
    const rows = windowStability(place(records), [null, 2030]);
    expect(rows[1]!.visits).toBe(0);
    expect(rows[1]!.outsideFullWindowInterval).toBe(false);
  });
});

/* ===========================================================================
 * Timestamp quality
 * ========================================================================= */

describe('timestampQuality', () => {
  it('centres on zero when visits really are recorded at the low', () => {
    // Built by placing each visit's median timestamp exactly at that day's low.
    const records: CalibrationRecord[] = [];
    for (let day = 5; day < 25; day++) {
      const date = { year: 2026, month: 7, day };
      const start = Date.UTC(2026, 6, day, 7);
      const end = Date.UTC(2026, 6, day + 1, 7);
      let lowMs = start;
      let lowFt = Infinity;
      for (const s of SERIES.samples) {
        if (s.tMs < start || s.tMs >= end) continue;
        if (s.ft < lowFt) {
          lowFt = s.ft;
          lowMs = s.tMs;
        }
      }
      records.push(record({ observerLogin: `o-${day}`, observedOn: date, observedAtMs: lowMs }));
    }

    const quality = timestampQuality(place(records), SERIES);
    expect(quality.timedVisits).toBe(20);
    expect(Math.abs(quality.medianHours!)).toBeLessThan(0.2);
    expect(quality.withinBand).toBe(1);
  });

  it('counts visits with a date and no time separately rather than as zero offset', () => {
    // A visit with no time is unresolved. Folding it in at zero would report the
    // timestamps as better centred than the evidence supports.
    const quality = timestampQuality(place([record({ observedAtMs: null })]), SERIES);
    expect(quality.timedVisits).toBe(0);
    expect(quality.untimedVisits).toBe(1);
    expect(quality.withinBand).toBeNull();
  });
});

/* ===========================================================================
 * Day / night
 * ========================================================================= */

describe('dayNightSplit', () => {
  it('classifies on the day low, which is what the window predicate acts on', () => {
    const split = dayNightSplit(
      place([
        record({ observerLogin: 'a', observedOn: { year: 2026, month: 7, day: 15 } }),
        record({ observerLogin: 'b', observedOn: LOW_DAY }),
      ]),
      CABRILLO.lat,
      CABRILLO.lon,
      TZ,
    );
    expect(split.dayVisits + split.nightVisits).toBe(2);
    expect(split.perBin.reduce((n, b) => n + b.day + b.night, 0)).toBeLessThanOrEqual(2);
  });

  it('does not divide by zero on no visits', () => {
    expect(dayNightSplit([], CABRILLO.lat, CABRILLO.lon, TZ).dayFraction).toBe(0);
  });
});

/* ===========================================================================
 * Obscuring losses
 * ========================================================================= */

describe('obscuringLossesByTaxon', () => {
  it('attributes a loss through ancestry, and only to frozen-list taxa', () => {
    const names = new Map([
      [PHYLLOSPADIX, 'Phyllospadix'],
      [MEGATHURA, 'Megathura crenulata'],
    ]);
    const losses = obscuringLossesByTaxon(
      [
        record({ taxonId: 72298, ancestorIds: [47126, PHYLLOSPADIX, 72298] }),
        record({ taxonId: MEGATHURA, ancestorIds: [MEGATHURA] }),
        record({ taxonId: 999, ancestorIds: [998] }),
      ],
      names,
    );
    expect(losses).toHaveLength(2);
    expect(losses.map((l) => l.name).sort()).toEqual(['Megathura crenulata', 'Phyllospadix']);
  });

  it('is empty when nothing was withheld', () => {
    expect(obscuringLossesByTaxon([], new Map())).toEqual([]);
  });
});
