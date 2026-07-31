/**
 * Every diagnostic issue #32 requires. Pure.
 *
 * These are not decoration. Two of them would have caught, on sight, mistakes
 * that took a full audit to find:
 *
 *   The per-taxon height distribution is what makes diver contamination
 *   obvious -- Panulirus interruptus reading a median +3.40 ft at La Jolla Cove
 *   against -0.23 ft at Cabrillo is not something anyone has to interpret.
 *
 *   The leave-one-out table is what makes LIST LENGTH visible. The label is an
 *   OR across taxa, so adding a taxon can only raise the rate and removing one
 *   can only lower it. #30's rule that "no change is justified by turning more
 *   cells green" can otherwise be satisfied silently by adding a species, and
 *   nobody would see it happen.
 *
 * The window-stability and sensitivity tables exist because #30's radius grid
 * was measured at CABRILLO ONLY, which is the richest spot by a factor of five.
 * Thin spots may be far more sensitive and must not be assumed from it.
 *
 * The centring grid is the same argument one step further. The radius grid
 * varies the disc's SIZE and #81 measured that its CENTRE is the thing that
 * moves -- the disc sits on the spots.json pin and at five of eight spots the
 * pin is not on the rock. Cabrillo, the spot #30's radius insensitivity was
 * measured at, is the best-centred spot in the corridor, so that result is
 * precisely the one that does not transfer.
 */

import { findExtrema, type TideExtremum, type TideSeries } from '../../../core/feeds/coops-predictions.ts';
import { daylightBounds } from '../../../core/spot/daylight.ts';
import { distanceMetres } from '../../../core/feeds/inat-observations.ts';
import { localDateInZone, type LocalDate } from '../../../core/time.ts';
import {
  amplitudeRatio,
  binVisits,
  collapseToVisits,
  placeVisits,
  wilsonInterval,
  type BinResult,
  type CalibrationRecord,
  type PlacedVisit,
} from './join.ts';
import {
  CENTRING_MATERIAL_RATIO,
  CENTRING_NEAR_PIN_M,
  CENTRING_STEP_M,
  STABILITY_WINDOWS,
  TIMESTAMP_QUALITY_BAND_HOURS,
} from './config.ts';

/* ===========================================================================
 * Small statistics
 * ========================================================================= */

/** Linear-interpolated percentile of a numeric sample. `p` in [0, 1]. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/* ===========================================================================
 * Filter attrition
 * ========================================================================= */

/**
 * Surviving counts after every filter stage, in order.
 *
 * A rate from 16 visits must visibly be from 16 visits. #32 requires the count
 * after each stage rather than a single before-and-after, because #30 found the
 * attrition was not where the predecessor brief thought it was: the null
 * timestamp filter it made a headline of removes ~1%, while the accuracy bar it
 * gave one line to removes 35-53%.
 */
export interface FilterStage {
  name: string;
  surviving: number;
  removed: number;
  note: string;
}

/* ===========================================================================
 * Positional accuracy
 * ========================================================================= */

/**
 * The two accuracy fractions, reported SEPARATELY.
 *
 * iNaturalist's `acc_below` silently excludes null accuracy as well as
 * imprecise accuracy, and at Cabrillo #30 measured those as 21.5% and 14% --
 * very different things conflated into one 35% number. A record with no stated
 * accuracy is unresolved, not imprecise, and this pipeline filters on neither.
 */
export interface AccuracyProfile {
  records: number;
  nullAccuracy: number;
  nullFraction: number;
  imprecise: number;
  impreciseFraction: number;
  precise: number;
}

export function accuracyProfile(records: readonly CalibrationRecord[]): AccuracyProfile {
  const nullAccuracy = records.filter((r) => r.positionalAccuracyM === null).length;
  const imprecise = records.filter(
    (r) => r.positionalAccuracyM !== null && r.positionalAccuracyM > 100,
  ).length;
  return {
    records: records.length,
    nullAccuracy,
    nullFraction: records.length === 0 ? 0 : nullAccuracy / records.length,
    imprecise,
    impreciseFraction: records.length === 0 ? 0 : imprecise / records.length,
    precise: records.length - nullAccuracy - imprecise,
  };
}

/* ===========================================================================
 * Per-taxon height distribution: the contamination detector a human can read
 * ========================================================================= */

export interface TaxonHeightRow {
  taxonId: number;
  name: string;
  role: 'target' | 'denominator';
  visits: number;
  medianFt: number | null;
  p25Ft: number | null;
  p75Ft: number | null;
}

export function taxonHeightDistribution(
  visits: readonly PlacedVisit[],
  taxa: readonly { taxon_id: number; name: string; role: 'target' | 'denominator' }[],
): TaxonHeightRow[] {
  return taxa
    .map((taxon) => {
      const heights = visits
        .filter((v) => v.matchedTaxonIds.includes(taxon.taxon_id))
        .map((v) => v.dayLowFt);
      return {
        taxonId: taxon.taxon_id,
        name: taxon.name,
        role: taxon.role,
        visits: heights.length,
        medianFt: percentile(heights, 0.5),
        p25Ft: percentile(heights, 0.25),
        p75Ft: percentile(heights, 0.75),
      };
    })
    .sort((a, b) => (a.medianFt ?? Infinity) - (b.medianFt ?? Infinity));
}

/* ===========================================================================
 * Leave-one-taxon-out
 * ========================================================================= */

export interface LeaveOneOutRow {
  removedTaxonId: number;
  removedName: string;
  /** Visits still labelled a hit without this taxon. */
  hits: number;
  hitsDelta: number;
  amplitudeRatio: number | null;
  amplitudeDelta: number | null;
  /** True when removing this one taxon flips the spot's verdict. */
  flipsVerdict: boolean;
}

/**
 * Recompute the table with each target taxon removed in turn.
 *
 * Non-negotiable per #32. The label is an OR, so every shift is in one
 * direction, and a list that quietly grew would show up here as nothing at all
 * unless the table is published every run.
 *
 * Only TARGETS are removed. Removing a denominator taxon changes which visits
 * exist rather than which are hits, which is a different question and one the
 * sensitivity grid is closer to.
 */
export function leaveOneOut(
  visits: readonly PlacedVisit[],
  targets: readonly { taxon_id: number; name: string }[],
  gate: number,
): LeaveOneOutRow[] {
  const baselineBins = binVisits(visits);
  const baselineRatio = amplitudeRatio(baselineBins);
  const baselineHits = visits.filter((v) => v.isHit).length;
  const baselinePasses = baselineRatio !== null && baselineRatio >= gate;

  return targets.map((target) => {
    const remaining = new Set(
      targets.filter((t) => t.taxon_id !== target.taxon_id).map((t) => t.taxon_id),
    );
    const without = visits.map((v) => ({
      ...v,
      isHit: v.matchedTaxonIds.some((id) => remaining.has(id)),
    }));

    const bins = binVisits(without);
    const ratio = amplitudeRatio(bins);
    const hits = without.filter((v) => v.isHit).length;
    const passes = ratio !== null && ratio >= gate;

    return {
      removedTaxonId: target.taxon_id,
      removedName: target.name,
      hits,
      hitsDelta: hits - baselineHits,
      amplitudeRatio: ratio,
      amplitudeDelta: ratio !== null && baselineRatio !== null ? ratio - baselineRatio : null,
      flipsVerdict: passes !== baselinePasses,
    };
  });
}

/* ===========================================================================
 * Radius x accuracy sensitivity, per spot
 * ========================================================================= */

export interface SensitivityCell {
  radiusM: number;
  accuracyBarM: number | null;
  visits: number;
  /** Rate per bin, aligned to the bin table. null where the bin is empty. */
  rates: (number | null)[];
  binVisits: number[];
  amplitudeRatio: number | null;
}

/**
 * Re-run the whole join at each radius and accuracy bar.
 *
 * The pull is made at the widest radius in the grid and narrowed here, so every
 * cell is drawn from the identical record set and no cell costs a request.
 *
 * The accuracy bar is applied to RECORDS before collapsing, not to visits after
 * it: a bar applied afterwards would keep a visit alive on the strength of one
 * imprecise record, which is not what an accuracy filter means.
 */
export function sensitivityGrid(
  records: readonly CalibrationRecord[],
  series: TideSeries,
  timeZone: string,
  allTaxonIds: ReadonlySet<number>,
  targetTaxonIds: ReadonlySet<number>,
  radiiKm: readonly number[],
  accuracyBars: readonly (number | null)[],
): SensitivityCell[] {
  const cells: SensitivityCell[] = [];
  for (const radiusKm of radiiKm) {
    for (const bar of accuracyBars) {
      const kept = records.filter(
        (r) =>
          r.distanceM <= radiusKm * 1000 &&
          (bar === null || (r.positionalAccuracyM !== null && r.positionalAccuracyM <= bar)),
      );
      const placed = placeVisits(
        collapseToVisits(kept, allTaxonIds, targetTaxonIds),
        series,
        timeZone,
      );
      const bins = binVisits(placed);
      cells.push({
        radiusM: radiusKm * 1000,
        accuracyBarM: bar,
        visits: placed.length,
        rates: bins.map((b) => b.rate),
        binVisits: bins.map((b) => b.visits),
        amplitudeRatio: amplitudeRatio(bins),
      });
    }
  }
  return cells;
}

/* ===========================================================================
 * Centring: is the disc on the rock?
 * ========================================================================= */

/**
 * Metres per radian of great circle, the sphere `distanceMetres` measures on.
 *
 * Restated here because lib/inat.ts keeps it inside the function. The two MUST
 * agree: a centre generated on one sphere and then measured on another sits
 * somewhere other than where this diagnostic says it does, and every count in
 * the grid would be a count of the wrong disc. A test asserts the round trip
 * rather than the constant -- a centre offset 250 m north reads 250 m from the
 * pin under `distanceMetres` -- so the agreement is measured, not declared.
 */
const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * A centre offset `eastM` east and `northM` north of a coordinate.
 *
 * First-order local tangent plane. Over the <=500 m this grid reaches, the
 * error against the sphere is under a millimetre; over the whole earth it would
 * be nonsense, which is why the caller's offsets are bounded by the pull.
 */
export function offsetCentre(
  lat: number,
  lon: number,
  eastM: number,
  northM: number,
): { lat: number; lon: number } {
  return {
    lat: lat + toDeg(northM / EARTH_RADIUS_M),
    // The parallel shrinks with latitude and this corridor sits near 33 deg N,
    // where that is a 16% correction: dividing by the equatorial value would put
    // a 500 m east offset 84 m short of 500 m east.
    lon: lon + toDeg(eastM / (EARTH_RADIUS_M * Math.cos(toRad(lat)))),
  };
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** 16-point compass label for a bearing in degrees clockwise from north. */
export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16]!;
}

export interface CentringCell {
  /** Metres east of the pin. Negative is west. */
  eastM: number;
  /** Metres north of the pin. Negative is south. */
  northM: number;
  /** Metres from the pin to this centre. Zero at the pin itself. */
  offsetM: number;
  /** Degrees clockwise from north, or null at the pin, which has no bearing. */
  bearingDeg: number | null;
  /** 16-point compass label, or null at the pin. */
  compass: string | null;
  /**
   * RECORDS inside the disc at this centre.
   *
   * A record count. The pipeline's unit is the visit and `visits` beside this is
   * that, collapsed by the pipeline's own function. Both are carried because
   * they are not interchangeable and #81's figures were counts.
   */
  records: number;
  /** Visits -- one (observer, local day) -- inside the disc at this centre. */
  visits: number;
  /**
   * True when the grid could not step OUTWARD from this cell: at least one of
   * its eight lattice neighbours was not searched, because it fell outside the
   * pull. A best offset sitting here makes its ratio a LOWER BOUND -- the real
   * optimum is somewhere this grid cannot see. All five of #81's refusing spots
   * put their best disc on their grid's boundary.
   */
  onSearchBoundary: boolean;
}

export interface CentringDiagnostic {
  /** The shipped disc's radius, in metres. The grid never varies this. */
  discRadiusM: number;
  /** How far the pulled record set reaches. The grid cannot look past it. */
  pullRadiusM: number;
  stepM: number;
  /** `pullRadiusM - discRadiusM`: the furthest a disc can move and stay whole. */
  maxOffsetM: number;
  /** The probe radius for `recordsNearPin`. */
  nearPinRadiusM: number;
  /** RECORDS within `nearPinRadiusM` of the pin. A record count, not visits. */
  recordsNearPin: number;
  /** The pin's own cell: the shipped disc, recomputed by this grid. */
  pin: CentringCell;
  /** Every searched centre, in row-major order from the south-west. */
  cells: CentringCell[];
  /** The richest disc on the grid by RECORDS. Ties go to the one nearest the pin. */
  bestByRecords: CentringCell;
  /** The richest disc on the grid by VISITS. Not always the same cell. */
  bestByVisits: CentringCell;
  /** `bestByRecords.records / pin.records`, or null when the pin holds none. */
  recordsRatio: number | null;
  /** `bestByVisits.visits / pin.visits`, or null when the pin holds none. */
  visitsRatio: number | null;
  /** `bestByRecords.onSearchBoundary`, hoisted: the headline ratio's caveat. */
  onSearchBoundary: boolean;
  /** True when no searched disc holds materially more records than the pin's. */
  centred: boolean;
  /** The bar `centred` was decided against. Decides nothing else. */
  materialRatio: number;
}

/**
 * Where the records are, relative to where the pin says they are.
 *
 * #81 measured the disc centred on the spots.json pin and found the pin off the
 * rock at five of eight spots -- the same five that refuse. The pipeline could
 * not tell "few people go here" from "we looked in the wrong place" and reported
 * the first, so this reports the second where it is true.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does not compute
 * ---------------------------------------------------------------------------
 *
 * No rate, no bin table, no amplitude ratio at an offset centre. Whether a
 * refusal survives a recentred disc is #62's open question 7, and answering it
 * needs a DEFENSIBLE centre rather than the densest one -- a coordinate is a
 * join against an authority, which is #69. Binning an offset disc here would
 * produce a publishable-looking rate for a spot at a centre nobody has
 * justified, so the shape of this function is the guard: it never touches the
 * tide series and cannot produce a rate.
 *
 * And more records is NOT automatically better data. floor-calibration.md §1
 * flags beach-level slugs covering several benches -- la-jolla-cove and
 * la-jolla-shores most of all -- so a disc recentred 500 m away may be
 * aggregating two of them, which is a different defect rather than a fix.
 *
 * ---------------------------------------------------------------------------
 * Why the grid stops at `pullRadiusM - discRadiusM`
 * ---------------------------------------------------------------------------
 *
 * The pull is made once, at the widest radius in the sensitivity grid, and every
 * cell is narrowed from it in memory -- so this costs no requests, exactly as
 * the radius grid does. A disc offset further than the difference would hang
 * partly outside the pulled set, and its count would be a truncation reported as
 * a measurement: the low number this repo exists not to emit. Cells beyond it
 * are not searched at all rather than searched and caveated, and
 * `onSearchBoundary` is how the reader learns the search stopped.
 *
 * At the shipped 1000 m pull and 500 m disc that reach is 500 m, which is
 * narrower than #81's count queries, whose 5x5 grid corners sat at 707 m. Every
 * ratio here is therefore a lower bound on #81's, and #81's were themselves
 * lower bounds. Both instruments say the same thing about direction.
 */
export function centringDiagnostic(
  records: readonly CalibrationRecord[],
  spot: { lat: number; lon: number },
  allTaxonIds: ReadonlySet<number>,
  targetTaxonIds: ReadonlySet<number>,
  options: {
    discRadiusM: number;
    pullRadiusM: number;
    stepM?: number;
    nearPinRadiusM?: number;
    materialRatio?: number;
  },
): CentringDiagnostic {
  const { discRadiusM, pullRadiusM } = options;
  const stepM = options.stepM ?? CENTRING_STEP_M;
  const nearPinRadiusM = options.nearPinRadiusM ?? CENTRING_NEAR_PIN_M;
  const materialRatio = options.materialRatio ?? CENTRING_MATERIAL_RATIO;
  const maxOffsetM = pullRadiusM - discRadiusM;

  if (maxOffsetM < stepM) {
    throw new Error(
      `centringDiagnostic: a ${discRadiusM} m disc inside a ${pullRadiusM} m pull can move ` +
        `${maxOffsetM} m before it hangs outside the records that were pulled, which is less ` +
        `than one ${stepM} m step. There is no grid to search, and searching one anyway would ` +
        'report a truncated disc as a fuller one.',
    );
  }

  const rings = Math.floor(maxOffsetM / stepM);
  // Which lattice points were searched, so a cell can ask whether the grid could
  // have stepped outward from it. Integer keys: eastM and northM are whole
  // multiples of an integer step, so there is no float equality here.
  const searched = new Set<string>();
  const offsets: { eastM: number; northM: number; offsetM: number }[] = [];
  for (let row = -rings; row <= rings; row++) {
    for (let col = -rings; col <= rings; col++) {
      const eastM = col * stepM;
      const northM = row * stepM;
      const offsetM = Math.hypot(eastM, northM);
      // A DISC of candidate centres, not a square. A corner of the square would
      // reach 1.41x further than the axes and hang outside the pull.
      if (offsetM > maxOffsetM) continue;
      searched.add(`${eastM},${northM}`);
      offsets.push({ eastM, northM, offsetM });
    }
  }

  const onSearchBoundary = (eastM: number, northM: number): boolean => {
    for (const de of [-stepM, 0, stepM]) {
      for (const dn of [-stepM, 0, stepM]) {
        if (de === 0 && dn === 0) continue;
        if (!searched.has(`${eastM + de},${northM + dn}`)) return true;
      }
    }
    return false;
  };

  const cells: CentringCell[] = offsets.map(({ eastM, northM, offsetM }) => {
    const centre = offsetCentre(spot.lat, spot.lon, eastM, northM);
    const inDisc = records.filter(
      (r) => distanceMetres(centre.lat, centre.lon, r.lat, r.lon) <= discRadiusM,
    );
    const bearingDeg =
      offsetM === 0 ? null : ((toDeg(Math.atan2(eastM, northM)) % 360) + 360) % 360;
    return {
      eastM,
      northM,
      offsetM,
      bearingDeg,
      compass: bearingDeg === null ? null : compassPoint(bearingDeg),
      records: inDisc.length,
      // The pipeline's own collapse, not a second definition of a visit.
      visits: collapseToVisits(inDisc, allTaxonIds, targetTaxonIds).length,
      onSearchBoundary: onSearchBoundary(eastM, northM),
    };
  });

  const pin = cells.find((c) => c.offsetM === 0)!;

  // Ties go to the cell NEAREST the pin, and the pin is nearest to itself. Two
  // discs holding the same records is not evidence that the disc should move.
  const best = (key: 'records' | 'visits'): CentringCell =>
    [...cells].sort(
      (a, b) => b[key] - a[key] || a.offsetM - b.offsetM || a.eastM - b.eastM || a.northM - b.northM,
    )[0]!;

  const bestByRecords = best('records');
  const bestByVisits = best('visits');

  return {
    discRadiusM,
    pullRadiusM,
    stepM,
    maxOffsetM,
    nearPinRadiusM,
    recordsNearPin: records.filter((r) => r.distanceM <= nearPinRadiusM).length,
    pin,
    cells,
    bestByRecords,
    bestByVisits,
    recordsRatio: pin.records === 0 ? null : bestByRecords.records / pin.records,
    visitsRatio: pin.visits === 0 ? null : bestByVisits.visits / pin.visits,
    onSearchBoundary: bestByRecords.onSearchBoundary,
    // <=, so a spot whose pin already holds the most records is centred rather
    // than failing a strict comparison against itself.
    centred: bestByRecords.records <= pin.records * materialRatio,
    materialRatio,
  };
}

/* ===========================================================================
 * Window stability
 * ========================================================================= */

export interface StabilityRow {
  fromYear: number | null;
  visits: number;
  rates: (number | null)[];
  binVisits: number[];
  amplitudeRatio: number | null;
  /**
   * True when some bin's rate in this window falls outside the FULL window's
   * own 95% interval for that bin.
   *
   * That is the comparison #32 asks for -- "a spot whose rates move further
   * than their own binomial interval across windows". Compared against the full
   * window rather than pairwise, so one thin recent slice cannot indict the
   * whole spot on its own noise.
   */
  outsideFullWindowInterval: boolean;
}

export function windowStability(
  visits: readonly PlacedVisit[],
  windows: readonly (number | null)[] = STABILITY_WINDOWS,
): StabilityRow[] {
  const fullBins = binVisits(visits);
  const fullIntervals = fullBins.map((b) =>
    b.visits === 0 ? null : wilsonInterval(b.hits, b.visits),
  );

  return windows.map((fromYear) => {
    const slice =
      fromYear === null ? visits : visits.filter((v) => v.observedOn.year >= fromYear);
    const bins = binVisits(slice);

    let outside = false;
    for (const [i, bin] of bins.entries()) {
      const interval = fullIntervals[i];
      // Only judge bins that are usable in BOTH windows. A bin that thins out to
      // three visits will sit outside any interval, and that is a statement
      // about the slice's size rather than about the spot's stability.
      if (!interval || bin.rate === null || !bin.usable || !fullBins[i]!.usable) continue;
      if (bin.rate < interval[0] || bin.rate > interval[1]) outside = true;
    }

    return {
      fromYear,
      visits: slice.length,
      rates: bins.map((b) => b.rate),
      binVisits: bins.map((b) => b.visits),
      amplitudeRatio: amplitudeRatio(bins),
      outsideFullWindowInterval: outside,
    };
  });
}

/* ===========================================================================
 * Timestamp quality
 * ========================================================================= */

export interface TimestampQuality {
  /** Visits carrying at least one timed record. */
  timedVisits: number;
  /** Visits carrying a date and no time at all. */
  untimedVisits: number;
  p10Hours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  /** Share of timed visits whose median time is within the band of a low. */
  withinBand: number | null;
  bandHours: number;
}

/**
 * How far a visit's median timestamp sits from the nearest predicted low.
 *
 * #30 measured p10 -2.0 h, median +0.0 h, p90 +2.1 h at Cabrillo, with 79% of
 * visits inside +/-2 h; Sunset Cliffs 82%. If people were entering times from
 * memory this would be smeared across the day. It is tightly centred on the
 * low.
 *
 * This is the ONLY direct evidence available on whether observation times can be
 * trusted, and nobody had computed it before #30. It is a required report
 * diagnostic for that reason: the predictor deliberately does not use the
 * timestamp, so this is the check that the decision to ignore it was taken for
 * the stated reason rather than to paper over a broken field.
 */
export function timestampQuality(
  visits: readonly PlacedVisit[],
  series: TideSeries,
  bandHours: number = TIMESTAMP_QUALITY_BAND_HOURS,
): TimestampQuality {
  const lows = findExtrema(series)
    .filter((e) => e.kind === 'low')
    .sort((a, b) => a.tMs - b.tMs);

  const timed = visits.filter((v) => v.medianObservedAtMs !== null);
  const offsets: number[] = [];
  for (const visit of timed) {
    const nearest = nearestLow(lows, visit.medianObservedAtMs!);
    if (nearest === null) continue;
    offsets.push((visit.medianObservedAtMs! - nearest.tMs) / 3_600_000);
  }

  const within = offsets.filter((h) => Math.abs(h) <= bandHours).length;
  return {
    timedVisits: timed.length,
    untimedVisits: visits.length - timed.length,
    p10Hours: percentile(offsets, 0.1),
    medianHours: percentile(offsets, 0.5),
    p90Hours: percentile(offsets, 0.9),
    withinBand: offsets.length === 0 ? null : within / offsets.length,
    bandHours,
  };
}

/** Binary search for the low nearest an instant. */
function nearestLow(lows: readonly TideExtremum[], tMs: number): TideExtremum | null {
  if (lows.length === 0) return null;
  let lo = 0;
  let hi = lows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lows[mid]!.tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [lows[lo]!, lows[Math.max(0, lo - 1)]!];
  return candidates[0]!.tMs - tMs === 0 ||
    Math.abs(candidates[0]!.tMs - tMs) <= Math.abs(candidates[1]!.tMs - tMs)
    ? candidates[0]!
    : candidates[1]!;
}

/* ===========================================================================
 * Day/night split
 * ========================================================================= */

export interface DayNightSplit {
  dayVisits: number;
  nightVisits: number;
  dayFraction: number;
  /** Day/night counts per bin, so the lowest bin's share is visible on its own. */
  perBin: { binIndex: number; day: number; night: number }[];
}

/**
 * Whether each visit's DAY LOW fell in daylight.
 *
 * Classified on the low rather than on the observation time, because the thing
 * being checked is the mismatch with lib/windows.ts -- which clips its window to
 * daylight and would never open one on a low that happens after dark. A rate
 * partly derived from nights is being applied by a daytime-only rule.
 *
 * REPORTED, NOT FILTERED ON. SoCal's lowest winter lows are at night, so
 * filtering would amputate the lowest bin, which is the one the whole table
 * turns on. #32 states this explicitly and it is worth restating at the code.
 */
export function dayNightSplit(
  visits: readonly PlacedVisit[],
  lat: number,
  lon: number,
  timeZone: string,
): DayNightSplit {
  const perBin = new Map<number, { day: number; night: number }>();
  let dayVisits = 0;
  let nightVisits = 0;

  // Cached per calendar date: daylightBounds is trigonometry and a busy day can
  // hold twenty visits.
  const cache = new Map<string, { sunriseMs: number; sunsetMs: number } | null>();

  for (const visit of visits) {
    const date: LocalDate = localDateInZone(visit.dayLowMs, timeZone);
    const key = `${date.year}-${date.month}-${date.day}`;
    let bounds = cache.get(key);
    if (bounds === undefined) {
      const daylight = daylightBounds(lat, lon, date);
      bounds =
        daylight.kind === 'sun-crosses-horizon'
          ? { sunriseMs: daylight.sunriseMs, sunsetMs: daylight.sunsetMs }
          : null;
      cache.set(key, bounds);
    }

    const isDay =
      bounds !== null && visit.dayLowMs >= bounds.sunriseMs && visit.dayLowMs <= bounds.sunsetMs;
    if (isDay) dayVisits++;
    else nightVisits++;

    if (visit.binIndex !== null) {
      const bucket = perBin.get(visit.binIndex) ?? { day: 0, night: 0 };
      if (isDay) bucket.day++;
      else bucket.night++;
      perBin.set(visit.binIndex, bucket);
    }
  }

  return {
    dayVisits,
    nightVisits,
    dayFraction: visits.length === 0 ? 0 : dayVisits / visits.length,
    perBin: [...perBin.entries()]
      .map(([binIndex, counts]) => ({ binIndex, ...counts }))
      .sort((a, b) => a.binIndex - b.binIndex),
  };
}

/* ===========================================================================
 * Obscuring losses by taxon
 * ========================================================================= */

export interface ObscuringLoss {
  taxonId: number;
  name: string;
  obscuredRecords: number;
}

/**
 * Which taxa lose records to geoprivacy.
 *
 * Counted from records that were pulled and then dropped, which is why the
 * pull does NOT send `geoprivacy=open`: filtering server-side would make this
 * diagnostic unmeasurable, and #32 requires it. The dropped records' coordinates
 * are randomised, so they are counted and nothing else -- never placed, never
 * binned, never used to establish that a visit happened.
 */
export function obscuringLossesByTaxon(
  obscuredRecords: readonly CalibrationRecord[],
  names: ReadonlyMap<number, string>,
): ObscuringLoss[] {
  const counts = new Map<number, number>();
  for (const record of obscuredRecords) {
    for (const id of [record.taxonId, ...record.ancestorIds]) {
      if (names.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([taxonId, obscuredRecords]) => ({
      taxonId,
      name: names.get(taxonId)!,
      obscuredRecords,
    }))
    .sort((a, b) => b.obscuredRecords - a.obscuredRecords);
}

/** Re-exported so the report and the runner agree on the bin table's shape. */
export type { BinResult };
