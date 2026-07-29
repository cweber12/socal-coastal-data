/**
 * The join: records to visits, visits to the day's lowest low, visits to bins.
 *
 * Pure. No network, no clock, no I/O. Everything that decides a published number
 * is in here so it can be tested against synthetic cases built to trip exactly
 * one thing each.
 *
 * ---------------------------------------------------------------------------
 * Why the predictor is the day's lowest low and not the observation timestamp
 * ---------------------------------------------------------------------------
 *
 * #30 measured three candidates by amplitude ratio -- the lowest usable bin's
 * rate over the highest usable bin's:
 *
 *   A  height at the observation timestamp     cabrillo 3.85   sunset-cliffs 4.13
 *   B  the day's lowest low                    cabrillo 12.28  sunset-cliffs 9.24
 *   C  the half-day's lowest low (AM/PM)       cabrillo 6.84   sunset-cliffs 12.92
 *
 * B wins for a better reason than robustness to timestamp error. A person on the
 * reef for ninety minutes around a -1.5 ft low sees what a -1.5 ft low uncovers,
 * wherever their shutter happened to fall. The timestamp samples one instant of
 * a visit whose exposure was set by the low, so it systematically understates
 * exposure and blurs the signal.
 *
 * C is rejected because the AM/PM split partly encodes SEASON: SoCal's lower low
 * migrates between morning and evening across the year, and it shows -- Sunset
 * Cliffs' C column runs 0.15 and back up to 0.35.
 *
 * B also hardens contamination detection. Under A, La Jolla Cove scored 1.90
 * against a gate of 2.0, uncomfortably marginal. Under B it scores 0.95.
 */

import { localDayBounds, type LocalDate } from '../../lib/time.ts';
import type { TideSeries } from '../../lib/tide.ts';
import { BIN_EDGES, USABLE_BIN_MIN_VISITS } from './config.ts';

/* ===========================================================================
 * Records
 * ========================================================================= */

/** One iNaturalist observation, reduced to what the calibration reads. */
export interface CalibrationRecord {
  id: number;
  observerLogin: string;
  /** iNaturalist's local calendar date. The visit key, and the predictor's day. */
  observedOn: LocalDate;
  /** The observation instant, or null when the record carries only a date. */
  observedAtMs: number | null;
  lat: number;
  lon: number;
  /** Great-circle metres from the spot. Computed at parse time against the spot. */
  distanceM: number;
  /** As published. null is a real and common value -- 21.5% at Cabrillo. */
  positionalAccuracyM: number | null;
  taxonId: number;
  /** Needed so a genus target matches a species-level record. */
  ancestorIds: number[];
}

/**
 * Does this record match one of the target taxa?
 *
 * Matched on `taxon.id` OR `taxon.ancestor_ids`, so the one genus target --
 * Phyllospadix -- catches the species-level records that make up almost all of
 * its corpus. Matching on id alone would silently drop them and make a target
 * look absent rather than present.
 */
export function matchedTaxa(
  record: CalibrationRecord,
  taxonIds: ReadonlySet<number>,
): number[] {
  // A Set, because iNaturalist's `ancestor_ids` ENDS WITH the taxon's own id --
  // measured, not assumed. Collecting into an array would return [48645, 48645]
  // for a Megathura record. Nothing downstream is wrong today, since
  // collapseToVisits dedupes anyway, but a per-taxon count built on this by a
  // later caller would double every self-matching record.
  const matched = new Set<number>();
  if (taxonIds.has(record.taxonId)) matched.add(record.taxonId);
  for (const ancestor of record.ancestorIds) {
    if (taxonIds.has(ancestor)) matched.add(ancestor);
  }
  return [...matched];
}

/* ===========================================================================
 * Visits
 * ========================================================================= */

/**
 * One visit: one observer, one local day.
 *
 * A FILTER STAGE, not a diagnostic. Collapsing before anything is counted is
 * what stops one photo-heavy walk voting thirty times, and it reduces N by
 * 1.5-2x. A rate computed over records rather than visits is a rate over
 * cameras.
 */
export interface Visit {
  observerLogin: string;
  observedOn: LocalDate;
  recordCount: number;
  /** True when at least one record in the visit matched a target taxon. */
  isHit: boolean;
  /**
   * The visit's median observation instant, or null when no record carried a
   * time. Used only by the timestamp-quality diagnostic; the predictor does not
   * read it.
   */
  medianObservedAtMs: number | null;
  /**
   * The FROZEN-LIST ids this visit matched, target or denominator, resolved
   * through ancestry.
   *
   * Not the raw `taxon.id`s. The one genus target, Phyllospadix, is almost never
   * the recorded taxon -- the records are P. torreyi and P. scouleri -- so a
   * per-taxon diagnostic or a leave-one-out built on raw ids would report the
   * genus as absent and its removal as costless, which is the opposite of what
   * #30 measured for the analogous Megathura case.
   */
  matchedTaxonIds: number[];
  /** Smallest distance among the visit's records, for the sensitivity grid. */
  minDistanceM: number;
  /** How many of the visit's records carried no positional accuracy. */
  nullAccuracyRecords: number;
  /** How many carried an accuracy worse than 100 m. */
  impreciseRecords: number;
}

const dateKey = (d: LocalDate): string =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Median of a sorted-in-place copy. Even counts take the lower of the two middles. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * Collapse records to visits, labelling each with the frozen-list taxa it
 * matched and whether any of them was a target.
 *
 * `allTaxonIds` is targets AND denominator, because the denominator is what
 * makes a visit a visit: somebody who recorded only anemones was still at the
 * reef. Without it the denominator would be visits that recorded a target, in
 * which every visit is a hit and every rate is 1.0.
 */
export function collapseToVisits(
  records: readonly CalibrationRecord[],
  allTaxonIds: ReadonlySet<number>,
  targetTaxonIds: ReadonlySet<number>,
): Visit[] {
  const byVisit = new Map<string, CalibrationRecord[]>();
  for (const record of records) {
    const key = `${record.observerLogin} ${dateKey(record.observedOn)}`;
    const bucket = byVisit.get(key);
    if (bucket) bucket.push(record);
    else byVisit.set(key, [record]);
  }

  const visits: Visit[] = [];
  for (const group of byVisit.values()) {
    const times = group
      .map((r) => r.observedAtMs)
      .filter((t): t is number => t !== null);

    const matchedTaxonIds = [
      ...new Set(group.flatMap((r) => matchedTaxa(r, allTaxonIds))),
    ].sort((a, b) => a - b);

    visits.push({
      observerLogin: group[0]!.observerLogin,
      observedOn: group[0]!.observedOn,
      recordCount: group.length,
      isHit: matchedTaxonIds.some((id) => targetTaxonIds.has(id)),
      medianObservedAtMs: median(times),
      matchedTaxonIds,
      minDistanceM: Math.min(...group.map((r) => r.distanceM)),
      nullAccuracyRecords: group.filter((r) => r.positionalAccuracyM === null).length,
      impreciseRecords: group.filter(
        (r) => r.positionalAccuracyM !== null && r.positionalAccuracyM > 100,
      ).length,
    });
  }

  // Stable order, so a report diff between runs is about the data.
  visits.sort(
    (a, b) =>
      dateKey(a.observedOn).localeCompare(dateKey(b.observedOn)) ||
      a.observerLogin.localeCompare(b.observerLogin),
  );
  return visits;
}

/* ===========================================================================
 * The predictor
 * ========================================================================= */

/**
 * The minimum predicted height over a local day.
 *
 * The interval is `[localMidnight, nextLocalMidnight)`, from lib/time.ts, which
 * is 23 or 25 hours long across a DST transition. Adding a fixed 24 hours would
 * clip an hour of tide off one day a year and double-count an hour on another --
 * and in March the clipped hour is 02:00 to 03:00, which in this corridor is
 * exactly where a winter lower low sits.
 *
 * Throws when the series does not cover the day. A gap is a hard failure, not a
 * skipped record: silently dropping the days a series happens not to cover would
 * bias the sample toward whatever the series does cover.
 */
export function dayMinimum(
  series: TideSeries,
  date: LocalDate,
  timeZone: string,
): { ft: number; tMs: number } {
  const { startMs, endMs } = localDayBounds(date, timeZone);

  const first = series.samples[0];
  const last = series.samples[series.samples.length - 1];
  if (!first || !last) {
    throw new Error(`dayMinimumFt: the prediction series is empty.`);
  }
  if (startMs < first.tMs || endMs > last.tMs + 1) {
    throw new Error(
      `dayMinimumFt: ${dateKey(date)} in ${timeZone} spans ` +
        `[${new Date(startMs).toISOString()}, ${new Date(endMs).toISOString()}) which is not ` +
        `covered by the series [${new Date(first.tMs).toISOString()}, ` +
        `${new Date(last.tMs).toISOString()}]. Predictions must cover the whole observation ` +
        'span; a gap is a hard failure rather than a skipped record.',
    );
  }

  let min = Infinity;
  let minMs = 0;
  let seen = 0;
  for (const sample of series.samples) {
    if (sample.tMs < startMs) continue;
    if (sample.tMs >= endMs) break;
    seen++;
    if (sample.ft < min) {
      min = sample.ft;
      minMs = sample.tMs;
    }
  }

  if (seen === 0) {
    throw new Error(
      `dayMinimum: no samples fall inside ${dateKey(date)} in ${timeZone}, so the series ` +
        'has a hole rather than merely ending early.',
    );
  }
  return { ft: min, tMs: minMs };
}

/** A visit with its predictor attached. */
export interface PlacedVisit extends Visit {
  /** The minimum predicted height over the visit's local day. */
  dayLowFt: number;
  /**
   * When that minimum occurred.
   *
   * Carried for the day/night diagnostic. The window predicate in lib/windows.ts
   * is daylight-clipped, so a rate derived partly from nights is being applied
   * by a daytime-only rule -- and that is REPORTED rather than filtered on,
   * because SoCal's lowest winter lows are at night and filtering them would
   * amputate the lowest bin, which is the one the whole table turns on.
   */
  dayLowMs: number;
  /** Which bin `dayLowFt` falls in, or null when it is outside every bin. */
  binIndex: number | null;
}

export function placeVisits(
  visits: readonly Visit[],
  series: TideSeries,
  timeZone: string,
): PlacedVisit[] {
  // One lookup per distinct day rather than per visit: a busy day at Cabrillo can
  // hold twenty visits and the minimum is a property of the day, not the visitor.
  const byDay = new Map<string, { ft: number; tMs: number }>();
  return visits.map((visit) => {
    const key = dateKey(visit.observedOn);
    let low = byDay.get(key);
    if (low === undefined) {
      low = dayMinimum(series, visit.observedOn, timeZone);
      byDay.set(key, low);
    }
    return { ...visit, dayLowFt: low.ft, dayLowMs: low.tMs, binIndex: binIndexFor(low.ft) };
  });
}

/* ===========================================================================
 * Bins
 * ========================================================================= */

export interface Bin {
  index: number;
  loFt: number;
  hiFt: number;
  label: string;
}

export const BINS: Bin[] = BIN_EDGES.slice(0, -1).map((lo, i) => ({
  index: i,
  loFt: lo,
  hiFt: BIN_EDGES[i + 1]!,
  label: `[${lo.toFixed(1)}, ${BIN_EDGES[i + 1]!.toFixed(1)})`,
}));

/**
 * Which bin a height falls in, or null when it falls outside all of them.
 *
 * Half-open `[lo, hi)`, so a value landing exactly on an edge belongs to the bin
 * above it and belongs to exactly one bin. Null rather than a clamp: a day whose
 * low is +4 ft is outside anything this table describes, and putting it in the
 * top bin would let days the calibration says nothing about vote in it.
 */
export function binIndexFor(ft: number): number | null {
  for (const bin of BINS) {
    if (ft >= bin.loFt && ft < bin.hiFt) return bin.index;
  }
  return null;
}

export interface BinResult {
  index: number;
  label: string;
  loFt: number;
  hiFt: number;
  visits: number;
  hits: number;
  /** hits / visits, or null when the bin holds no visits at all. */
  rate: number | null;
  /** True at or above USABLE_BIN_MIN_VISITS. Thin bins are reported, not used. */
  usable: boolean;
}

export function binVisits(visits: readonly PlacedVisit[]): BinResult[] {
  return BINS.map((bin) => {
    const inBin = visits.filter((v) => v.binIndex === bin.index);
    const hits = inBin.filter((v) => v.isHit).length;
    return {
      index: bin.index,
      label: bin.label,
      loFt: bin.loFt,
      hiFt: bin.hiFt,
      visits: inBin.length,
      hits,
      rate: inBin.length === 0 ? null : hits / inBin.length,
      usable: inBin.length >= USABLE_BIN_MIN_VISITS,
    };
  });
}

/* ===========================================================================
 * Summary statistics over the bin table
 * ========================================================================= */

/**
 * Lowest usable bin's rate over the highest usable bin's.
 *
 * Null when there are fewer than two usable bins, or when the highest usable
 * bin's rate is zero -- a ratio over zero is not "infinitely good", it is a bin
 * with no hits in it, and reporting Infinity would let a spot with a single
 * empty high bin pass the strongest gate in the pipeline.
 */
export function amplitudeRatio(bins: readonly BinResult[]): number | null {
  const usable = bins.filter((b) => b.usable && b.rate !== null);
  if (usable.length < 2) return null;
  const lowest = usable[0]!;
  const highest = usable[usable.length - 1]!;
  if (highest.rate === 0) return null;
  return lowest.rate! / highest.rate!;
}

/**
 * The share of ordered usable-bin pairs whose rates decline with height.
 *
 * Ties are excluded from the denominator rather than counted for either side.
 * Two bins reading the same rate is not evidence that the rate declines and not
 * evidence that it does not, and folding ties in either direction would make the
 * criterion sensitive to how coarsely the rates happen to round.
 *
 * Returns null when every comparable pair ties, which the caller treats as a
 * failure -- an entirely flat table is exactly what "not declining" means.
 */
export function concordance(bins: readonly BinResult[]): {
  concordant: number;
  discordant: number;
  tied: number;
  fraction: number | null;
} {
  const usable = bins.filter((b) => b.usable && b.rate !== null);
  let concordant = 0;
  let discordant = 0;
  let tied = 0;

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const lower = usable[i]!.rate!;
      const higher = usable[j]!.rate!;
      if (lower > higher) concordant++;
      else if (lower < higher) discordant++;
      else tied++;
    }
  }

  const comparable = concordant + discordant;
  return {
    concordant,
    discordant,
    tied,
    fraction: comparable === 0 ? null : concordant / comparable,
  };
}

/** The largest share of visits contributed by any single observer. */
export function observerConcentration(visits: readonly PlacedVisit[]): {
  share: number;
  login: string | null;
  visits: number;
} {
  if (visits.length === 0) return { share: 0, login: null, visits: 0 };
  const counts = new Map<string, number>();
  for (const v of visits) counts.set(v.observerLogin, (counts.get(v.observerLogin) ?? 0) + 1);

  let topLogin: string | null = null;
  let topCount = 0;
  for (const [login, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topLogin = login;
    }
  }
  return { share: topCount / visits.length, login: topLogin, visits: topCount };
}

/**
 * Wilson score interval for a binomial rate.
 *
 * Wilson rather than the normal approximation: the normal interval on 16 visits
 * at a rate of 0.9 runs past 1.0, and an interval that includes impossible
 * values is not one to print beside a count. Reported for context only -- no
 * refusal is decided by it, because #30 established that a crossing derived from
 * these intervals swings "days per year with a window" by 5-6x.
 */
export function wilsonInterval(hits: number, visits: number, z = 1.96): [number, number] {
  if (visits === 0) return [0, 1];
  const p = hits / visits;
  const denom = 1 + (z * z) / visits;
  const centre = p + (z * z) / (2 * visits);
  const spread = z * Math.sqrt((p * (1 - p)) / visits + (z * z) / (4 * visits * visits));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}
