/**
 * The refusal criteria. Pure.
 *
 * A refusal is a valid output, and on current data five of eight spots are
 * expected to produce one. Nothing here exists to be relaxed: "stricter results
 * are valid results", and no change to this file is justified by the number of
 * spots that publish afterwards.
 *
 * Every criterion is EVALUATED even after one has already failed, because the
 * report publishes all four values for every spot. A refusal that only says
 * which gate tripped first hides that a spot failed three of them, and a spot
 * one visit short of a usable bin looks the same as a diver-contaminated one.
 */

import {
  MAX_SINGLE_OBSERVER_SHARE,
  MIN_AMPLITUDE_RATIO,
  MIN_CONCORDANT_PAIRS,
  MIN_USABLE_BINS,
  USABLE_BIN_MIN_VISITS,
} from './config.ts';
import {
  amplitudeRatio,
  concordance,
  observerConcentration,
  type BinResult,
  type PlacedVisit,
} from './join.ts';

export type RefusalCode =
  | 'too-few-usable-bins'
  | 'not-declining'
  | 'amplitude-below-gate'
  | 'observer-concentration';

export interface CriterionResult {
  code: RefusalCode;
  passed: boolean;
  /** The measured value, or null when it could not be computed at all. */
  value: number | null;
  threshold: number;
  /** One sentence, publishable as-is. */
  statement: string;
}

export interface RefusalVerdict {
  publishes: boolean;
  /** Every criterion, in a fixed order, whether or not an earlier one failed. */
  criteria: CriterionResult[];
  /**
   * Why this spot emits no rate, or null when it publishes.
   *
   * Names every failing criterion, not just the first. `shared/calibration.json`
   * carries this string verbatim and the generator makes a consumer that reads a
   * rate without checking it fail to typecheck.
   */
  nullReason: string | null;
}

export function evaluateRefusals(
  bins: readonly BinResult[],
  visits: readonly PlacedVisit[],
): RefusalVerdict {
  const usableBins = bins.filter((b) => b.usable && b.rate !== null);
  const ratio = amplitudeRatio(bins);
  const conc = concordance(bins);
  const observers = observerConcentration(visits);

  const criteria: CriterionResult[] = [
    {
      code: 'too-few-usable-bins',
      passed: usableBins.length >= MIN_USABLE_BINS,
      value: usableBins.length,
      threshold: MIN_USABLE_BINS,
      statement:
        `${usableBins.length} of ${bins.length} bins hold at least ${USABLE_BIN_MIN_VISITS} ` +
        `visits; ${MIN_USABLE_BINS} are needed, because the amplitude gate compares a low bin ` +
        'against a high one and needs something between them.',
    },
    {
      code: 'not-declining',
      // Null fraction means every comparable pair tied, which is a flat table --
      // exactly what "not declining" describes, so it fails rather than passing
      // for want of evidence against it.
      passed: conc.fraction !== null && conc.fraction >= MIN_CONCORDANT_PAIRS,
      value: conc.fraction,
      threshold: MIN_CONCORDANT_PAIRS,
      statement:
        conc.fraction === null
          ? `no usable pair of bins differs in rate, so the table is flat rather than declining.`
          : `${conc.concordant} of ${conc.concordant + conc.discordant} comparable bin pairs ` +
            `decline with height (${(conc.fraction * 100).toFixed(0)}%, ${conc.tied} tied and ` +
            `excluded); ${(MIN_CONCORDANT_PAIRS * 100).toFixed(0)}% is needed.`,
    },
    {
      code: 'amplitude-below-gate',
      passed: ratio !== null && ratio >= MIN_AMPLITUDE_RATIO,
      value: ratio,
      threshold: MIN_AMPLITUDE_RATIO,
      statement:
        ratio === null
          ? 'the amplitude ratio could not be computed: fewer than two usable bins, or the ' +
            'highest usable bin has no hits at all.'
          : `the lowest usable bin's rate is ${ratio.toFixed(2)}x the highest usable bin's; ` +
            `${MIN_AMPLITUDE_RATIO.toFixed(1)}x is needed. The highest bin measures this spot's ` +
            'own tide-independent background, and a distinct low zone has to at least double it.',
    },
    {
      code: 'observer-concentration',
      passed: observers.share <= MAX_SINGLE_OBSERVER_SHARE,
      value: observers.share,
      threshold: MAX_SINGLE_OBSERVER_SHARE,
      statement:
        observers.login === null
          ? 'there are no visits, so there is no distribution of observers.'
          : `the largest single observer contributed ${observers.visits} of ${visits.length} ` +
            `visits (${(observers.share * 100).toFixed(0)}%); the limit is ` +
            `${(MAX_SINGLE_OBSERVER_SHARE * 100).toFixed(0)}%. One enthusiast is not a ` +
            'distribution.',
    },
  ];

  const failed = criteria.filter((c) => !c.passed);
  return {
    publishes: failed.length === 0,
    criteria,
    nullReason:
      failed.length === 0
        ? null
        : `Refused on ${failed.length} of ${criteria.length} criteria. ` +
          failed.map((c) => `${c.code}: ${c.statement}`).join(' '),
  };
}
