import { describe, expect, it } from 'vitest';

import { daylightBounds } from './daylight';
import { localDateInZone, sameLocalDate } from '../time';

const iso = (ms: number) => new Date(ms).toISOString();


describe('daylightBounds', () => {
  /*
   * Oracle: the US Naval Observatory, aa.usno.navy.mil/api/rstt/oneday, fetched
   * 2026-07-27. Six cases spanning both solstices, both equinoxes, PST and PDT,
   * and both ends of the corridor.
   *
   * USNO rather than a convenience API, because the two convenience APIs
   * disagree with USNO and with each other. For La Jolla on 2026-07-27:
   *
   *   USNO                   rise 05:59      set 19:51
   *   api.sunrisesunset.io   rise 05:58:49   set 19:51:57   (rounds to 05:59 / 19:52)
   *   api.sunrise-sunset.org rise 05:58:17   set 19:52:51   (rounds to 05:58 / 19:53)
   *
   * sunrise-sunset.org contradicts USNO at both ends. Taking it as the oracle
   * would have condemned a correct implementation and invited "fixing" the
   * horizon constant to match a worse source. This is the units-and-timezone
   * discipline of the rest of the repo applied to a reference value: find out
   * which clock the number is on before trusting it.
   *
   * USNO publishes to the minute, so the assertion is that our value rounds to
   * the minute USNO reports -- which is the strongest claim its resolution
   * supports. Actual worst drift across all 18 values is 30 s.
   */
  const ZONE = 'America/Los_Angeles';

  const USNO = [
    { label: 'La Jolla, 2026-07-27',      lat: 32.8669, lon: -117.2571, date: { year: 2026, month: 7,  day: 27 }, rise: '05:59', noon: '12:56', set: '19:51' },
    { label: 'Border Field, 2026-12-21',  lat: 32.539,  lon: -117.124,  date: { year: 2026, month: 12, day: 21 }, rise: '06:46', noon: '11:47', set: '16:47' },
    { label: 'La Jolla, 2026-06-21',      lat: 32.8669, lon: -117.2571, date: { year: 2026, month: 6,  day: 21 }, rise: '05:41', noon: '12:51', set: '20:01' },
    { label: 'Cabrillo, 2026-03-20',      lat: 32.669,  lon: -117.245,  date: { year: 2026, month: 3,  day: 20 }, rise: '06:52', noon: '12:56', set: '19:01' },
    { label: 'Oceanside, 2026-09-22',     lat: 33.208,  lon: -117.394,  date: { year: 2026, month: 9,  day: 22 }, rise: '06:38', noon: '12:42', set: '18:46' },
    { label: 'Sunset Cliffs, 2026-02-14', lat: 32.723,  lon: -117.256,  date: { year: 2026, month: 2,  day: 14 }, rise: '06:33', noon: '12:03', set: '17:34' },
  ] as const;

  /** Wall clock in the corridor's zone, rounded to the minute as USNO reports. */
  const usnoMinute = (utcMs: number): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(Math.round(utcMs / 60_000) * 60_000));

  for (const o of USNO) {
    describe(o.label, () => {
      const result = daylightBounds(o.lat, o.lon, o.date);
      if (result.kind !== 'sun-crosses-horizon') {
        throw new Error(`expected the sun to cross the horizon at ${o.label}`);
      }

      it('matches the USNO sunrise minute', () => {
        expect(usnoMinute(result.sunriseMs), `sunrise, full precision ${iso(result.sunriseMs)}`).toBe(
          o.rise,
        );
      });

      it('matches the USNO sunset minute', () => {
        expect(usnoMinute(result.sunsetMs), `sunset, full precision ${iso(result.sunsetMs)}`).toBe(o.set);
      });

      it('matches the USNO upper-transit minute', () => {
        expect(usnoMinute(result.solarNoonMs), `transit, full precision ${iso(result.solarNoonMs)}`).toBe(
          o.noon,
        );
      });

      it('brackets solar noon with sunrise and sunset', () => {
        expect(result.sunriseMs).toBeLessThan(result.solarNoonMs);
        expect(result.solarNoonMs).toBeLessThan(result.sunsetMs);
        // dayLengthMin is carried unrounded; the two instants are rounded to
        // whole ms. They agree to within that rounding, not exactly.
        const gapMs = Math.abs(result.dayLengthMin * 60_000 - (result.sunsetMs - result.sunriseMs));
        expect(gapMs).toBeLessThan(2);
      });

      it('puts sunset on the next UTC date, as it must west of Greenwich', () => {
        expect(result.sunsetMs).toBeGreaterThan(
          Date.UTC(o.date.year, o.date.month - 1, o.date.day + 1),
        );
      });
    });
  }

  it('accounts for refraction and the solar semidiameter, not a bare 90 degrees', () => {
    // Sunrise is defined at 90.833 deg from the zenith: 34 arcmin of refraction
    // plus the sun's 16-arcmin semidiameter. A bare 90 deg puts both instants
    // about 3 min inward, which the USNO minute assertions above would catch --
    // this states the magnitude so the reason is on the record.
    const r = daylightBounds(32.8669, -117.2571, { year: 2026, month: 7, day: 27 });
    if (r.kind !== 'sun-crosses-horizon') throw new Error('unreachable in this corridor');
    // 13:53:07 is the io oracle's day length; a bare-90 horizon gives ~13:47.
    expect(r.dayLengthMin).toBeGreaterThan(13 * 60 + 50);
    expect(r.dayLengthMin).toBeLessThan(13 * 60 + 56);
  });

  it('evaluates declination at each event, making the day asymmetric about transit', () => {
    // Away from the solstices declination moves ~0.4 deg/day, so the interval
    // from sunrise to transit is not the same as transit to sunset. A single
    // noon declination cannot express that and reports them equal.
    const r = daylightBounds(32.8669, -117.2571, { year: 2026, month: 3, day: 20 });
    if (r.kind !== 'sun-crosses-horizon') throw new Error('unreachable');
    const morning = r.solarNoonMs - r.sunriseMs;
    const afternoon = r.sunsetMs - r.solarNoonMs;
    expect(morning).not.toBe(afternoon);
    // Real but small: seconds, not minutes. A large gap would mean a bug.
    expect(Math.abs(morning - afternoon) / 1000).toBeLessThan(120);
  });

  it('keeps solar noon on the requested local date all year, at both ends of the corridor', () => {
    // The function takes a local calendar date and computes from the same
    // calendar date in UTC. That is only sound where the civil offset tracks
    // longitude. Rather than assert it in prose, check every day of a year at
    // the northern and southern ends of the corridor, across both DST switches.
    const ZONE = 'America/Los_Angeles';
    const ends = [
      { lat: 33.208, lon: -117.394 }, // Oceanside Harbor
      { lat: 32.539, lon: -117.124 }, // Border Field
    ];
    let checked = 0;
    for (const end of ends) {
      let date = { year: 2026, month: 1, day: 1 };
      while (date.year === 2026) {
        const r = daylightBounds(end.lat, end.lon, date);
        expect(r.kind).toBe('sun-crosses-horizon');
        expect(
          sameLocalDate(localDateInZone(r.solarNoonMs, ZONE), date),
          `solar noon for ${date.year}-${date.month}-${date.day} at ${end.lat} fell on another local date`,
        ).toBe(true);
        if (r.kind === 'sun-crosses-horizon') {
          // Sunrise and sunset must land on the same local day as solar noon too.
          expect(sameLocalDate(localDateInZone(r.sunriseMs, ZONE), date)).toBe(true);
          expect(sameLocalDate(localDateInZone(r.sunsetMs, ZONE), date)).toBe(true);
        }
        checked++;
        const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
        date = {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
        };
      }
    }
    expect(checked).toBe(730);
  });

  it('day length peaks at the summer solstice and bottoms at the winter one', () => {
    const at = (month: number, day: number) => {
      const r = daylightBounds(32.8669, -117.2571, { year: 2026, month, day });
      if (r.kind !== 'sun-crosses-horizon') throw new Error('unreachable');
      return r.dayLengthMin;
    };
    expect(at(6, 21)).toBeGreaterThan(at(7, 27));
    expect(at(7, 27)).toBeGreaterThan(at(9, 21));
    expect(at(12, 21)).toBeLessThan(at(11, 21));
    // San Diego's range is roughly 9h50m to 14h10m.
    expect(at(12, 21)).toBeGreaterThan(9 * 60);
    expect(at(6, 21)).toBeLessThan(15 * 60);
  });

  it('reports polar day and polar night as distinct results, never as a dark day', () => {
    const svalbard = { lat: 78.22, lon: 15.65 };
    const midsummer = daylightBounds(svalbard.lat, svalbard.lon, { year: 2026, month: 6, day: 21 });
    const midwinter = daylightBounds(svalbard.lat, svalbard.lon, { year: 2026, month: 12, day: 21 });
    expect(midsummer.kind).toBe('sun-never-sets');
    expect(midwinter.kind).toBe('sun-never-rises');
  });

  it('throws on coordinates out of range', () => {
    expect(() => daylightBounds(91, 0, { year: 2026, month: 7, day: 27 })).toThrow(/latitude/);
    expect(() => daylightBounds(0, 181, { year: 2026, month: 7, day: 27 })).toThrow(/longitude/);
  });
});

/* =========================================================================
 * The pairing that matters: a corridor low, in local terms
 * ======================================================================= */
