import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NdbcDriftError, NdbcNoDataError, parseNdbcRealtime2 } from './ndbc';

/*
 * Fixture: realtime2 for 46254 (Scripps Nearshore), captured 2026-07-28 07:08 UTC.
 * Newest row is 2026-07-28 06:26, i.e. 42 minutes old at capture.
 */
const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/ndbc-46254-20260728.txt', import.meta.url)),
  'utf8',
);

/** Just after the fixture was captured. */
const NOW = Date.parse('2026-07-28T07:08:00Z');

const HEADER =
  '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n' +
  '#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n';

const row = (over: Partial<Record<'stamp' | 'wvht' | 'tide', string>> = {}) =>
  `${over.stamp ?? '2026 07 28 06 26'}  MM   MM   MM   ${over.wvht ?? '1.0'}     8   6.5 282` +
  `     MM    MM  24.7    MM   MM   MM    ${over.tide ?? 'MM'}\n`;

describe('parseNdbcRealtime2 on the captured payload', () => {
  const result = parseNdbcRealtime2(FIXTURE, '46254', NOW);

  it('reads the newest wave height and converts metres to feet', () => {
    expect(result.swellMetres).toBe(1.0);
    // 1.0 m is 3.2808 ft. One foot is exactly 0.3048 m, so this is definitional.
    expect(result.swellFt).toBeCloseTo(3.2808, 4);
  });

  it('reads the timestamp as UTC', () => {
    expect(new Date(result.observedAtMs).toISOString()).toBe('2026-07-28T06:26:00.000Z');
    expect(result.ageMinutes).toBeCloseTo(42, 0);
  });

  it('takes the first row, since the payload is newest-first', () => {
    expect(result.skippedRows).toBe(0);
    expect(result.totalRows).toBe(28);
  });
});

describe('unit discipline', () => {
  it('refuses to convert when WVHT is not published in metres', () => {
    // The whole point. If NDBC ever published feet, converting anyway would
    // inflate every reading by 3.28x and every swell would clear every ceiling.
    const feetHeader = HEADER.replace('  m   sec', ' ft   sec');
    expect(() => parseNdbcRealtime2(feetHeader + row(), '46254', NOW)).toThrow(NdbcDriftError);
    expect(() => parseNdbcRealtime2(feetHeader + row(), '46254', NOW)).toThrow(
      /published in "ft", not "m"/,
    );
  });

  it('does not fall back to a file-wide unit, because there is not one', () => {
    // TIDE, six columns after WVHT in the same row, is in feet. Any file-level
    // unit assumption is wrong here whichever unit is chosen -- so the error
    // message says so, and the parser only ever reads the column's own unit.
    const feetHeader = HEADER.replace('  m   sec', ' ft   sec');
    expect(() => parseNdbcRealtime2(feetHeader + row(), '46254', NOW)).toThrow(
      /TIDE in this same row is in feet/,
    );
  });

  it('locates WVHT by name, not by position', () => {
    // A column inserted upstream shifts everything right. Position 9 would then
    // hold DPD, which reads 8 to 20 for these buoys and would render as a
    // twenty-foot swell -- a plausible number, entirely wrong.
    const shifted =
      '#YY  MM DD hh mm WDIR WSPD GST  NEWCOL  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n' +
      '#yr  mo dy hr mn degT m/s  m/s     degC     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n' +
      '2026 07 28 06 26  MM   MM   MM   19.0     1.0     8   6.5 282     MM    MM  24.7    MM   MM   MM    MM\n';
    const result = parseNdbcRealtime2(shifted, '46254', NOW);
    expect(result.swellMetres).toBe(1.0); // not 19.0
  });

  it('rejects a wave height outside any plausible range', () => {
    // The largest ever recorded by a buoy is about 19 m. A 40 means the declared
    // unit is not what is being published.
    expect(() => parseNdbcRealtime2(HEADER + row({ wvht: '40.0' }), '46254', NOW)).toThrow(
      /outside any plausible range/,
    );
  });
});

describe('the timezone tripwire', () => {
  it('throws when the newest observation is in the future', () => {
    /*
     * The units row labels the time columns 'yr mo dy hr mn' with NO zone. Reading
     * them as UTC is an assumption, and it is the one that, taken wrongly, shifts
     * every reading by 7 hours. If the columns were actually Pacific, 06:26 would
     * resolve to 13:26 UTC -- six hours ahead of a 07:08 UTC clock. That is
     * exactly the signature this catches.
     */
    const asIfPacific = Date.parse('2026-07-28T01:08:00Z'); // pretend "now" is earlier
    expect(() => parseNdbcRealtime2(FIXTURE, '46254', asIfPacific)).toThrow(NdbcDriftError);
    expect(() => parseNdbcRealtime2(FIXTURE, '46254', asIfPacific)).toThrow(/in the future/);
    expect(() => parseNdbcRealtime2(FIXTURE, '46254', asIfPacific)).toThrow(/not UTC/);
  });

  it('allows a few minutes of clock skew', () => {
    // Buoy clocks are not synchronised with ours; a reading a little "ahead" is
    // ordinary and must not throw.
    const slightlyBehind = Date.parse('2026-07-28T06:20:00Z');
    expect(() => parseNdbcRealtime2(FIXTURE, '46254', slightlyBehind)).not.toThrow();
  });

  it('reports a stale reading rather than hiding it', () => {
    const muchLater = Date.parse('2026-07-30T07:08:00Z');
    const result = parseNdbcRealtime2(FIXTURE, '46254', muchLater);
    expect(result.ageMinutes).toBeCloseTo(2 * 24 * 60 + 42, 0);
  });

  it('rejects a two-digit year, which would resolve to 26 AD', () => {
    expect(() => parseNdbcRealtime2(HEADER + row({ stamp: '26 07 28 06 26' }), '46254', NOW)).toThrow(
      /not four digits/,
    );
  });
});

describe('missing data', () => {
  it('skips MM rows and reports how many it skipped', () => {
    const text = HEADER + row({ wvht: 'MM' }) + row({ wvht: 'MM' }) + row({ wvht: '1.4' });
    const result = parseNdbcRealtime2(text, '46254', NOW);
    expect(result.skippedRows).toBe(2);
    expect(result.swellMetres).toBe(1.4);
  });

  it('raises NoData, not Drift, when every row is MM', () => {
    // A buoy answering with no wave height is not delivering; it is not a bug in
    // this parser. Callers treat the two differently.
    const text = HEADER + row({ wvht: 'MM' }) + row({ wvht: 'MM' });
    expect(() => parseNdbcRealtime2(text, '46254', NOW)).toThrow(NdbcNoDataError);
    expect(() => parseNdbcRealtime2(text, '46254', NOW)).toThrow(/answering but not reporting/);
  });

  it('raises NoData on an empty body, not a calm sea', () => {
    expect(() => parseNdbcRealtime2('', '46254', NOW)).toThrow(NdbcNoDataError);
    expect(() => parseNdbcRealtime2('   \n  \n', '46254', NOW)).toThrow(NdbcNoDataError);
  });

  it('raises NoData when there are headers but no rows', () => {
    expect(() => parseNdbcRealtime2(HEADER, '46254', NOW)).toThrow(NdbcNoDataError);
  });

  it('does not read MM as zero', () => {
    // Number('MM') is NaN, but a careless parseFloat or a || 0 would make a dead
    // buoy read as a flat calm and clear every ceiling.
    const text = HEADER + row({ wvht: 'MM' });
    expect(() => parseNdbcRealtime2(text, '46254', NOW)).toThrow(NdbcNoDataError);
  });
});

describe('header drift', () => {
  it('throws when the time columns move', () => {
    const moved = HEADER.replace('#YY  MM DD hh mm', '#MM DD YY hh mm');
    expect(() => parseNdbcRealtime2(moved + row(), '46254', NOW)).toThrow(/time columns have moved/);
  });

  it('throws when the unit labels for time change', () => {
    const relabelled = HEADER.replace('#yr  mo dy hr mn', '#yr  mo dy hr sc');
    expect(() => parseNdbcRealtime2(relabelled + row(), '46254', NOW)).toThrow(/unit 4 is "sc"/);
  });

  it('throws when the two header lines stop corresponding', () => {
    const mismatched =
      '#YY  MM DD hh mm WVHT\n' + '#yr  mo dy hr mn m sec\n' + '2026 07 28 06 26 1.0\n';
    expect(() => parseNdbcRealtime2(mismatched, '46254', NOW)).toThrow(/no longer correspond/);
  });

  it('throws when WVHT disappears entirely', () => {
    const noWvht =
      '#YY  MM DD hh mm WDIR WSPD\n' + '#yr  mo dy hr mn degT m/s\n' + '2026 07 28 06 26 MM MM\n';
    expect(() => parseNdbcRealtime2(noWvht, '46254', NOW)).toThrow(/no WVHT column/);
  });

  it('throws when a data row has the wrong number of cells', () => {
    const short = HEADER + '2026 07 28 06 26  MM   MM   MM   1.0\n';
    expect(() => parseNdbcRealtime2(short, '46254', NOW)).toThrow(/cells against 19 columns/);
  });

  it('throws when the header lines lose their # prefix', () => {
    expect(() => parseNdbcRealtime2(HEADER.replace(/#/g, '') + row(), '46254', NOW)).toThrow(
      /'#'-prefixed header lines/,
    );
  });
});
