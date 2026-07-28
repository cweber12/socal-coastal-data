/**
 * NDBC realtime2 parser. Pure: no network, no ambient clock.
 *
 * ---------------------------------------------------------------------------
 * The format, measured on 2026-07-28 across all seven live corridor buoys
 * ---------------------------------------------------------------------------
 *
 *   #YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
 *   #yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
 *   2026 07 28 06 26  MM   MM   MM   1.2    18  10.1 206     MM    MM  24.2    MM   MM   MM    MM
 *
 * Whitespace-separated, newest row first, 19 columns. 46224, 46274, 46266,
 * 46225, 46254, 46258 and 46232 all serve byte-identical headers.
 *
 * Three things this parser refuses to assume:
 *
 * 1. THE UNIT OF WVHT. It is metres, and the second line says so. It is not
 *    read from a constant, it is read from that line and matched exactly
 *    against 'm'. This file is the clearest possible argument for doing it that
 *    way: WVHT is in metres and TIDE, six columns later in the SAME row, is in
 *    feet. A per-file unit assumption is wrong here no matter which unit you
 *    pick.
 *
 * 2. THE COLUMN POSITION. WVHT is located by name from the header, not by
 *    index. A column inserted upstream would otherwise silently shift wave
 *    height to whatever now sits in slot 9 -- dominant wave period, which for
 *    these buoys reads 8 to 20 and would render as a 20-foot swell.
 *
 * 3. THE TIMEZONE. The units row labels the time columns 'yr mo dy hr mn' with
 *    no zone at all. NDBC documents realtime2 as UTC, and the newest row bears
 *    that out -- 06:26 on 2026-07-28 was 39 minutes old at 07:05 UTC, whereas
 *    read as Pacific it would have been six hours in the future. Rather than
 *    rest on that, `parseNdbcRealtime2` takes `nowMs` and throws if the newest
 *    observation is in the future, so the assumption is checked on every call
 *    instead of once by hand.
 */

/** Exact, by definition: one foot is 0.3048 m. */
const METRES_TO_FEET = 1 / 0.3048;

/** NDBC's missing-value token. Not zero, not empty -- these two letters. */
const MISSING = 'MM';

/** The five leading time columns, and the units row's labels for them. */
const TIME_COLUMN_NAMES = ['YY', 'MM', 'DD', 'hh', 'mm'] as const;
const TIME_COLUMN_UNITS = ['yr', 'mo', 'dy', 'hr', 'mn'] as const;

/** The unit string WVHT must carry. Anything else and we do not convert. */
const EXPECTED_WVHT_UNIT = 'm';

/**
 * A clock skew allowance for the future-timestamp tripwire. Buoy clocks and the
 * server's clock are not synchronised, and a reading a few minutes "ahead" is
 * ordinary. Six hours ahead is the Pacific-read-as-UTC signature.
 */
const FUTURE_TOLERANCE_MS = 20 * 60_000;

export interface Wvht {
  /** Significant wave height, converted to feet from a confirmed 'm'. */
  swellFt: number;
  /** As published, before conversion. Kept so the UI can show the source value. */
  swellMetres: number;
  /** When the buoy observed it. UTC, checked against `nowMs`. */
  observedAtMs: number;
  /** How old the reading was at `nowMs`. */
  ageMinutes: number;
  /** How many rows were skipped for a missing WVHT before this one. */
  skippedRows: number;
  /** Total data rows in the payload. */
  totalRows: number;
}

export class NdbcDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdbcDriftError';
  }
}

export class NdbcNoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdbcNoDataError';
  }
}

/**
 * Parse a realtime2 text payload and return the newest usable wave height.
 *
 * Throws NdbcDriftError when the format is not what is pinned above -- a header
 * that has moved, a unit that is not metres, a timestamp that cannot be UTC.
 * Throws NdbcNoDataError when the format is intact but no row carries a wave
 * height. Callers distinguish the two: drift is a bug to surface, no data is a
 * buoy that is simply not delivering.
 */
export function parseNdbcRealtime2(text: string, buoyId: string, nowMs: number): Wvht {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new NdbcNoDataError(
      `NDBC ${buoyId}: empty body. A 200 carrying nothing is a dead source, not a calm sea.`,
    );
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 3) {
    throw new NdbcNoDataError(
      `NDBC ${buoyId}: ${lines.length} non-blank lines, so there are headers but no observations.`,
    );
  }

  const names = lines[0]!.replace(/^#/, '').trim().split(/\s+/);
  const units = lines[1]!.replace(/^#/, '').trim().split(/\s+/);

  if (!lines[0]!.startsWith('#') || !lines[1]!.startsWith('#')) {
    throw new NdbcDriftError(
      `NDBC ${buoyId}: expected two '#'-prefixed header lines; got ` +
        `${JSON.stringify(lines[0]!.slice(0, 40))} and ${JSON.stringify(lines[1]!.slice(0, 40))}.`,
    );
  }
  if (names.length !== units.length) {
    throw new NdbcDriftError(
      `NDBC ${buoyId}: ${names.length} column names but ${units.length} units. ` +
        'The two header lines no longer correspond, so no column can be trusted.',
    );
  }

  // The five leading time columns, pinned by name and by unit label.
  for (const [i, expected] of TIME_COLUMN_NAMES.entries()) {
    if (names[i] !== expected) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: column ${i} is ${JSON.stringify(names[i])}, expected ` +
          `${JSON.stringify(expected)}. The leading time columns have moved.`,
      );
    }
  }
  for (const [i, expected] of TIME_COLUMN_UNITS.entries()) {
    if (units[i] !== expected) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: unit ${i} is ${JSON.stringify(units[i])}, expected ` +
          `${JSON.stringify(expected)}.`,
      );
    }
  }

  // WVHT by name, never by index: a column inserted upstream would otherwise
  // shift wave height to dominant wave period, which reads 8 to 20 for these
  // buoys and would render as a twenty-foot swell.
  const wvhtIndex = names.indexOf('WVHT');
  if (wvhtIndex === -1) {
    throw new NdbcDriftError(
      `NDBC ${buoyId}: no WVHT column. Columns present: ${names.join(', ')}.`,
    );
  }

  const wvhtUnit = units[wvhtIndex];
  if (wvhtUnit !== EXPECTED_WVHT_UNIT) {
    throw new NdbcDriftError(
      `NDBC ${buoyId}: WVHT is published in ${JSON.stringify(wvhtUnit)}, not ` +
        `${JSON.stringify(EXPECTED_WVHT_UNIT)}. Refusing to convert on an unrecognised ` +
        'unit string -- note that TIDE in this same row is in feet, so there is no ' +
        'file-wide unit to fall back on.',
    );
  }

  const dataLines = lines.slice(2);
  let skippedRows = 0;

  for (const line of dataLines) {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== names.length) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: a data row has ${cells.length} cells against ${names.length} ` +
          `columns. Row: ${JSON.stringify(line.slice(0, 80))}`,
      );
    }

    const raw = cells[wvhtIndex]!;
    if (raw === MISSING) {
      skippedRows++;
      continue;
    }

    const metres = Number(raw);
    if (!Number.isFinite(metres)) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: WVHT reads ${JSON.stringify(raw)}, which is neither a number ` +
          `nor ${MISSING}.`,
      );
    }
    // Largest significant wave height ever recorded by a buoy is about 19 m.
    if (metres < 0 || metres > 25) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: WVHT of ${metres} m is outside any plausible range, so the ` +
          'declared unit is not what is actually being published.',
      );
    }

    const [year, month, day, hour, minute] = cells.slice(0, 5).map(Number);
    if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: unparseable timestamp ${cells.slice(0, 5).join(' ')}`,
      );
    }
    if (cells[0]!.length !== 4) {
      throw new NdbcDriftError(
        `NDBC ${buoyId}: year ${JSON.stringify(cells[0])} is not four digits. A ` +
          'two-digit year would be read as the year 26 AD.',
      );
    }

    const observedAtMs = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);

    /*
     * The timezone tripwire. The units row labels these columns with no zone, so
     * reading them as UTC is an assumption -- and it is the assumption that,
     * taken wrongly, ages or advances every reading by 7 hours. If the newest
     * observation is in the future, the assumption is wrong and this must fail
     * rather than report a value.
     */
    if (observedAtMs > nowMs + FUTURE_TOLERANCE_MS) {
      const aheadMinutes = Math.round((observedAtMs - nowMs) / 60_000);
      throw new NdbcDriftError(
        `NDBC ${buoyId}: newest observation ${new Date(observedAtMs).toISOString()} is ` +
          `${aheadMinutes} min in the future. The time columns carry no zone label and ` +
          'were read as UTC; a reading this far ahead means they are not UTC. Refusing ' +
          'to report a wave height on a clock that has not been established.',
      );
    }

    return {
      swellFt: metres * METRES_TO_FEET,
      swellMetres: metres,
      observedAtMs,
      ageMinutes: (nowMs - observedAtMs) / 60_000,
      skippedRows,
      totalRows: dataLines.length,
    };
  }

  throw new NdbcNoDataError(
    `NDBC ${buoyId}: all ${dataLines.length} rows carry ${MISSING} for WVHT. The buoy is ` +
      'answering but not reporting wave height.',
  );
}
