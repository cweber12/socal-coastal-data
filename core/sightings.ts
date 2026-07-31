/**
 * Joins parsed iNaturalist sightings to the predicted tide. Pure: no network,
 * no ambient clock.
 *
 * This is the join that makes the gallery ours rather than an iNaturalist
 * embed. A sighting reads "Sea hare — 0.4 ft, 40 min after the low", which ties
 * the record to the tide data on the rest of the page and lets a reader check
 * PRD #30's whole premise for themselves without taking anyone's word for it.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately does not do
 * ---------------------------------------------------------------------------
 *
 * It does not reimplement interpolation or extremum finding. Both come from
 * lib/tide.ts, which is measured against NOAA's own interval=hilo product and
 * carries the parabolic refinement; a second implementation here would be a
 * second answer that could disagree with the chart on the same page.
 *
 * It does not clamp. `heightAt` throws outside its series rather than returning
 * the nearest end, and that refusal is honoured here as a null tide with a
 * stated reason rather than being caught and turned into a plausible number.
 *
 * It does not guess a time. About 1% of the historical corpus carries a date
 * and no time (PRD #30). Those sightings render without a tide height, because
 * the tide at an unknown hour of a day whose range is 6 ft is not a number
 * anyone should be shown.
 *
 * It does not prefer photographed records when choosing what to show. The
 * newest N are the newest N, whatever their licence. Filling a gallery by
 * skipping over All-Rights-Reserved records would select the feed toward
 * observers who happen to license permissively, and then the page's claim about
 * what people are seeing would be a claim about what people are licensing.
 */

import { findExtrema, heightAt, type TideSeries } from '../core/feeds/coops-predictions';
import type { Sighting } from '../core/feeds/inat-observations';

/** How many sightings the gallery shows. */
export const SIGHTINGS_GALLERY_MAX = 6;

export interface SightingTide {
  /** Predicted height at the observation instant, in the series' units. */
  heightFt: number;
  /** Signed minutes from the nearest predicted low. Negative is before it. */
  minutesFromLow: number;
  lowMs: number;
  lowFt: number;
}

export interface AnnotatedSighting extends Sighting {
  /** Null when no height could be stated. Never a guess. */
  tide: SightingTide | null;
  /** Why there is no tide, present exactly when `tide` is null. */
  tideUnavailableReason: string | null;
}

/**
 * Attach the predicted tide to each sighting that carries a usable timestamp.
 *
 * `series` must be the station the spot actually binds to. All eight tidepool
 * spots share 9410230 today, but that is a property of the current contents of
 * spots.json rather than of the corridor, so the caller passes the series it
 * fetched for this spot rather than this module assuming one.
 */
export function annotateWithTide(
  sightings: readonly Sighting[],
  series: TideSeries | null,
): AnnotatedSighting[] {
  if (!series || series.samples.length < 3) {
    const reason = series
      ? 'the prediction series for this window is too short to read a height from'
      : 'tide predictions for this window could not be loaded';
    return sightings.map((s) => ({ ...s, tide: null, tideUnavailableReason: reason }));
  }

  // Computed once for the whole set rather than per sighting: findExtrema walks
  // the entire series, and a 16-day series is about 3,800 samples.
  const lows = findExtrema(series).filter((e) => e.kind === 'low');
  const first = series.samples[0]!.tMs;
  const last = series.samples[series.samples.length - 1]!.tMs;

  return sightings.map((sighting): AnnotatedSighting => {
    if (sighting.observedAtMs === null) {
      return {
        ...sighting,
        tide: null,
        tideUnavailableReason: 'this observation records a date but no time',
      };
    }
    if (sighting.observedAtMs < first || sighting.observedAtMs > last) {
      return {
        ...sighting,
        tide: null,
        tideUnavailableReason: 'this observation falls outside the predictions fetched for it',
      };
    }
    if (lows.length === 0) {
      return {
        ...sighting,
        tide: null,
        tideUnavailableReason: 'no predicted low was found in this window',
      };
    }

    let nearest = lows[0]!;
    for (const low of lows) {
      if (
        Math.abs(low.tMs - sighting.observedAtMs) < Math.abs(nearest.tMs - sighting.observedAtMs)
      ) {
        nearest = low;
      }
    }

    return {
      ...sighting,
      tide: {
        heightFt: heightAt(series, sighting.observedAtMs),
        minutesFromLow: (sighting.observedAtMs - nearest.tMs) / 60_000,
        lowMs: nearest.tMs,
        lowFt: nearest.ft,
      },
      tideUnavailableReason: null,
    };
  });
}

/**
 * The newest `limit` sightings, in the order the gallery renders them.
 *
 * The upstream query already orders by `observed_on desc`, but `observed_on` is
 * a date with no time, so records sharing a day arrive in an order iNaturalist
 * does not define. Sorting here by the observation INSTANT puts the actual
 * newest first, and falls back to the date when a record carries no time --
 * which is the only ordering available for it and is why the fallback exists
 * rather than dropping the record out of the sort.
 */
export function newestSightings<T extends Sighting>(
  sightings: readonly T[],
  limit: number = SIGHTINGS_GALLERY_MAX,
): T[] {
  const key = (s: Sighting): number =>
    s.observedAtMs ?? Date.UTC(s.observedOn.year, s.observedOn.month - 1, s.observedOn.day);
  return [...sightings].sort((a, b) => key(b) - key(a) || b.id - a.id).slice(0, limit);
}
