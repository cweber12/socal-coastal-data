/**
 * Every constant the calibration is decided by, in one file.
 *
 * Issue #32's rule is that every number in the output must trace to a query, a
 * taxa-config version and a stated constant. This is the third of those. None of
 * these is per-spot: #30 measured that the radius does not drive the answer,
 * which is what licenses one corridor-wide value rather than eight, and a
 * per-spot knob is how "stricter results are valid results" quietly becomes
 * "tune until the table looks reasonable".
 *
 * Nothing here may be changed to make more spots publish. If a value moves, the
 * commit says what evidence moved it.
 */

/* ===========================================================================
 * Acquisition
 * ========================================================================= */

/**
 * The corridor-wide radius, in kilometres.
 *
 * #30 measured Cabrillo's per-bin rates at 250 m, 500 m and 1000 m: they move by
 * <=0.02, under a quarter of the sampling interval. That measurement is what
 * licenses a single value. It was Cabrillo-only, which is why the sensitivity
 * grid is re-run per spot rather than assumed from the richest one.
 */
export const RADIUS_KM = 0.5;

/**
 * The radii the sensitivity grid reports.
 *
 * The pull is made at the LARGEST of these and narrowed in memory, so the grid
 * costs no extra requests and every cell is drawn from the identical record set.
 */
export const SENSITIVITY_RADII_KM = [0.25, 0.5, 1.0];

/** Accuracy bars the sensitivity grid reports. `null` means no bar, which is the shipped setting. */
export const SENSITIVITY_ACCURACY_M: (number | null)[] = [null, 100];

/**
 * Where the corpus starts.
 *
 * #30 measured that reaching further back buys 0.6% at Cabrillo and literally
 * nothing at Sunset Cliffs or Swami's -- 285 and 181 visits from 2010 and from
 * 2016, identical to the record. Pisaster ochraceus has 1 record at Cabrillo all
 * time after sea star wasting syndrome, so there is no pre-collapse baseline in
 * this corpus to lose either.
 */
export const CORPUS_START = { year: 2016, month: 1, day: 1 };

/**
 * Where the OFFLINE fixture corpus starts, and why it is not CORPUS_START.
 *
 * The fixtures are a deliberate `cc0`/`cc-by`-only capture, which is about a
 * tenth of the corpus, and they need a tide series to join against. A series
 * covering 2016 onward is ~35 MB of committed JSON; one year is 3.3 MB, 487 kB
 * as git stores it, and 2026 carries both DST transitions -- which is the one
 * property of the series the join genuinely depends on.
 *
 * So the offline run is a single year of a tenth of the corpus. It proves the
 * pipeline runs end to end, exercises every filter, both DST boundaries, all
 * four refusal criteria and every diagnostic. It does NOT reproduce the
 * published numbers, it says so in its own header, and it cannot overwrite
 * shared/calibration.json. Correctness is proved by the unit tests over the pure
 * modules, not by this.
 */
export const FIXTURE_CORPUS_START = { year: 2026, month: 1, day: 1 };

/** The licences the fixture capture is restricted to, so it can be redistributed. */
export const FIXTURE_LICENCES = ['cc0', 'cc-by'];

/** Records per page. iNaturalist's maximum, and what the cursoring is tested at. */
export const PER_PAGE = 200;

/**
 * iNaturalist asks for about one request a second.
 *
 * This pull is roughly 50 pages, so it is the one place in this repo where the
 * courtesy rate genuinely bites. It is honoured rather than approximated.
 */
export const REQUEST_INTERVAL_MS = 1100;

/**
 * The result window iNaturalist refuses past.
 *
 * `page`-based paging returns HTTP 403 beyond 10,000 results with "Result window
 * is too large... use a sliding window approach with id_above or id_below". A
 * try/except around that produces a silently truncated, order-biased sample, so
 * `id_above` cursoring is mandatory and the pull asserts it never paged.
 */
export const RESULT_WINDOW_LIMIT = 10_000;

export const DISPLAY_TIME_ZONE = 'America/Los_Angeles';

/* ===========================================================================
 * The predictor and its bins
 * ========================================================================= */

/**
 * Bin edges, half-open `[lo, hi)`, in feet above MLLW.
 *
 * A DISPLAY CHOICE, and nothing published may depend on them, because the
 * published number IS the per-bin count. NOAA publishes no datum below MLLW for
 * 9410230 -- MLLW 0.00, MLW +0.90, MSL +2.73 -- so these edges cannot be sourced
 * from an authority, which is exactly why nothing is allowed to rest on them.
 *
 * ---------------------------------------------------------------------------
 * 0.25 ft over 0.0-1.5 ft, coarse elsewhere. Declared 2026-07-30, for #43.
 * ---------------------------------------------------------------------------
 *
 * The previous edges were [-2.5, -1.0, -0.5, 0.0, 0.5, 1.0, 3.0], and they made
 * the question the permissiveness rule asks unanswerable. That rule --
 * `calibration/floor-calibration.md` §7, declared under #42 BEFORE any
 * re-binned rate was computed -- admits no floor whose marginal band sits below
 * 2x that spot's own tide-independent background. At Cabrillo the background is
 * the 1.0-3.0 band's 5.7%, so the crossing is 11.4%; the 0.5-1.0 band reads
 * 15.0%. Both numbers fall inside one 0.5 ft bin, so the crossing had a value
 * and no LOCATION. Narrowing the decision region is the whole change.
 *
 * The region is narrow and the rest is not, on purpose. Below 0.0 ft every spot
 * that publishes runs at three to seven times its own background, the crossing
 * is nowhere near, and splitting those bins would spend visits to resolve
 * something already resolved. Above 1.5 ft is background by construction and
 * one wide bin measures it better than six thin ones.
 *
 * Nothing is relaxed to pay for the width. USABLE_BIN_MIN_VISITS stays 15 and
 * MIN_AMPLITUDE_RATIO stays 2.0, so a 0.25 ft bin holding 14 visits drops out
 * of every gate that reads it. That is a measurement of what this corpus can
 * resolve at a quarter of a foot, not a reason to widen the bins until it can.
 *
 * Uniform corridor-wide. `calibration/README.md` forbids a per-spot bin scheme
 * in the same breath as a per-spot radius, and the temptation here is real:
 * Cabrillo has 1,223 visits and Torrey Pines has 31.
 */
export const BIN_EDGES = [
  // Coarse below the datum: high rates, no decision.
  -2.5, -1.0, -0.5,
  // The decision region, at 0.25 ft.
  0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5,
  // Background, in one bin.
  3.0,
];

/**
 * Visits a bin needs before its rate is used for anything.
 *
 * Below this the binomial interval is wider than the differences between bins,
 * so the bin cannot support the comparison the amplitude gate makes of it. Thin
 * bins are still REPORTED, with their counts; they are just not usable.
 */
export const USABLE_BIN_MIN_VISITS = 15;

/* ===========================================================================
 * Refusal criteria
 * ===========================================================================
 *
 * A refusal is a valid output. Five of eight spots are expected to refuse on
 * current data, each for a stated reason. Thin or contaminated data yields a
 * null rate and a reason, never a number with a wide error bar.
 */

/** The amplitude gate needs a low bin and a high bin, and something between them. */
export const MIN_USABLE_BINS = 3;

/**
 * Rates must fall as the tide rises.
 *
 * Measured over ordered pairs of usable bins. Ties are excluded from the
 * denominator rather than counted for either side: two bins reading the same
 * rate is not evidence that the rate declines, and it is not evidence that it
 * does not.
 */
export const MIN_CONCORDANT_PAIRS = 0.7;

/**
 * The contamination detector, and the one number here stated a priori.
 *
 * The BACKGROUND BAND measures that spot's TIDE-INDEPENDENT BACKGROUND --
 * surge-channel photos, wrong camera clocks, washed-up specimens -- which runs
 * around 0.20 at every spot. A spot must show a low-tide rate at least double
 * its own background to claim a distinct low zone.
 *
 * That band is the highest usable bin POOLED with every bin above it, and the
 * pooling is #72's fix rather than the original design: it was the highest
 * usable bin alone until #43's 0.25 ft edges made the bins above it individually
 * thin, at which point they were discarded and the denominator could land in the
 * middle of the range. `backgroundBand` in src/join.ts carries the measurement
 * and the reasoning. The BAR did not move for it.
 *
 * The bar comes from that reasoning and NOT from the observed gap between
 * spots. Reading it off the data would make it a description of this pull
 * rather than a test of it. On #30's figures La Jolla Cove scores 0.95 and La
 * Jolla Shores 0.68, both diver-contaminated and both caught -- but those
 * numbers are the gate's output, never its calibration.
 */
export const MIN_AMPLITUDE_RATIO = 2.0;

/** One enthusiast is not a distribution. */
export const MAX_SINGLE_OBSERVER_SHARE = 0.3;

/* ===========================================================================
 * Diagnostics
 * ========================================================================= */

/**
 * Start years for the window-stability table.
 *
 * A spot whose rates move further across these windows than their own binomial
 * interval is not measuring a stable thing and refuses on that basis.
 */
export const STABILITY_WINDOWS = [null, 2019, 2021, 2023] as const;

/** The timestamp-quality diagnostic's band. #30 measured 79-82% of visits inside it. */
export const TIMESTAMP_QUALITY_BAND_HOURS = 2;

/**
 * NPS's own published figure for Cabrillo, for the blind check.
 *
 * "At Cabrillo, a tide of 0.7 or lower provides the best opportunity to explore
 * the tidepools" -- nps.gov/cabr/learn/nature/tidepools.htm, read 2026-07-28.
 *
 * The observed rate at this height is printed beside the claim ONCE. It is the
 * only independent check available and tuning against it consumes it, so nothing
 * in this file may be adjusted until they agree.
 */
export const NPS_CABRILLO_BEST_FT = 0.7;

/**
 * 1.1.0 for #43: the bin scheme went from 6 bins to 10.
 *
 * A minor bump rather than a patch because `bin_edges` and every `bins` array in
 * `shared/calibration.json` changed shape, and a reader holding two copies of
 * that file needs to be able to tell which scheme each was computed under. No
 * count, filter, gate or taxon moved, so it is not a major.
 */
export const CALIBRATION_VERSION = '1.1.0';
