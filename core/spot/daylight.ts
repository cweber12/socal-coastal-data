/**
 * Sunrise, sunset and solar noon for a place and a calendar date.
 *
 * A SPOT FACT, not a zone fact and not a feed. Daylight is true of the whole
 * spot regardless of which cross-shore band anyone is standing in, which is why
 * it lives under core/spot/ alongside the operator gate and the MPA designation.
 *
 * NOAA's solar position algorithm, the same one behind gml.noaa.gov/grad/solcalc.
 * Offline and pure. It sat inside the NOAA CO-OPS parser until #122, which is
 * backwards twice over: there is no sun API in this stack and there should not
 * be, so this was the one thing in that file that could NOT rot, sharing a
 * header with the payload-drift discipline for the things that do.
 *
 * ---------------------------------------------------------------------------
 * Which oracle this was checked against, and why it matters
 * ---------------------------------------------------------------------------
 *
 * Three sources were compared for La Jolla on 2026-07-27, and they do not
 * agree with each other:
 *
 *   USNO (aa.usno.navy.mil)   rise 05:59      set 19:51      (to the minute)
 *   api.sunrisesunset.io      rise 05:58:49   set 19:51:57
 *   api.sunrise-sunset.org    rise 05:58:17   set 19:52:51
 *
 * sunrise-sunset.org is the outlier: its rise rounds to 05:58 and its set to
 * 19:53, both of which contradict USNO. It runs the simplified Almanac for
 * Computers algorithm, which is about 80 s wide at each end. Had it been taken
 * as the oracle, a correct implementation would have looked broken and the
 * "fix" would have been to widen the horizon constant until the numbers matched
 * a worse source.
 *
 * USNO is the authority and is what the tests assert against, at its own
 * one-minute reporting resolution, over six cases spanning both solstices, both
 * equinoxes and both ends of the corridor.
 *
 * Accuracy actually achieved: within 30 s of USNO's reported minute on all six.
 * That is well inside anything a person acts on, but it is NOT nothing against
 * the 45-minute window threshold -- roughly 1 minute of a 45-minute call. The
 * threshold should not be read as exact to the second.
 */

import type { LocalDate } from '../time';

const DEG = Math.PI / 180;
const rad = (d: number) => d * DEG;
const deg = (r: number) => r / DEG;

/**
 * Sunrise and sunset are defined at 90.833° from the zenith, not 90°: 34
 * arcminutes of atmospheric refraction plus the sun's own 16-arcminute
 * semidiameter, since the moment named is when the upper limb touches the
 * horizon. Dropping it puts both instants about three minutes wrong.
 */
const SUNRISE_ZENITH_DEG = 90.833;

/** Julian Day at 00:00 UTC on a Gregorian calendar date. */
function julianDayAtUtcMidnight(date: LocalDate): number {
  let y = date.year;
  let m = date.month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + date.day + b - 1524.5
  );
}

interface SolarTerms {
  /** Solar declination, degrees. */
  declinationDeg: number;
  /** Equation of time, minutes. */
  eqTimeMin: number;
}

function solarTerms(julianDay: number): SolarTerms {
  const jc = (julianDay - 2451545) / 36525;

  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  const eqCtr =
    Math.sin(rad(meanAnom)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * jc) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;

  const trueLong = meanLong + eqCtr;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * jc));

  const meanObliq =
    23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * jc));

  const declinationDeg = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(appLong))));

  const varY = Math.tan(rad(obliqCorr / 2)) ** 2;
  const eqTimeMin =
    4 *
    deg(
      varY * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * varY * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * varY * varY * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)),
    );

  return { declinationDeg, eqTimeMin };
}

export type Daylight =
  | {
      kind: 'sun-crosses-horizon';
      sunriseMs: number;
      sunsetMs: number;
      solarNoonMs: number;
      /** Sunrise to sunset, in minutes. */
      dayLengthMin: number;
    }
  | { kind: 'sun-never-rises'; solarNoonMs: number }
  | { kind: 'sun-never-sets'; solarNoonMs: number };

/**
 * Sunrise, sunset and solar noon for a place and a calendar date.
 *
 * `date` is the local calendar date. The returned instants bracket solar noon
 * for that date, and sunset legitimately falls on the following UTC date west
 * of Greenwich -- for this corridor, sunset is always tomorrow in UTC terms.
 * The returned instants are epoch ms and carry no zone, so that is a fact about
 * how they render, not about what they are.
 *
 * This holds wherever the civil offset tracks longitude, which covers the whole
 * US West Coast. The test suite asserts that solar noon lands on the requested
 * date in America/Los_Angeles for every day of a year at both ends of the
 * corridor, so the assumption is checked rather than trusted.
 *
 * The polar cases cannot arise in this corridor but are returned as distinct
 * results rather than being clamped, because a clamped 00:00-to-00:00 day would
 * read as a perfectly ordinary dark day.
 */
export function daylightBounds(lat: number, lon: number, date: LocalDate): Daylight {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`daylightBounds: latitude ${lat} is out of range`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`daylightBounds: longitude ${lon} is out of range`);
  }

  const midnightJd = julianDayAtUtcMidnight(date);
  const midnightMs = Date.UTC(date.year, date.month - 1, date.day);

  // Locate solar noon first. The equation of time is evaluated at noon rather
  // than at 00:00 UTC; one refinement pass gets there. Skipping it leaves the
  // transit about 30 s out.
  let solarNoonMin = 720 - 4 * lon - solarTerms(midnightJd).eqTimeMin;
  for (let pass = 0; pass < 2; pass++) {
    const terms = solarTerms(midnightJd + solarNoonMin / 1440);
    solarNoonMin = 720 - 4 * lon - terms.eqTimeMin;
  }
  const solarNoonMs = Math.round(midnightMs + solarNoonMin * 60_000);

  /** Half-day length in minutes, using the declination at a given instant. */
  const halfDayMinAt = (minutesFromUtcMidnight: number): number | 'never-rises' | 'never-sets' => {
    const { declinationDeg } = solarTerms(midnightJd + minutesFromUtcMidnight / 1440);
    const cosHourAngle =
      Math.cos(rad(SUNRISE_ZENITH_DEG)) /
        (Math.cos(rad(lat)) * Math.cos(rad(declinationDeg))) -
      Math.tan(rad(lat)) * Math.tan(rad(declinationDeg));
    if (cosHourAngle > 1) return 'never-rises';
    if (cosHourAngle < -1) return 'never-sets';
    // Four minutes of clock per degree of hour angle.
    return 4 * deg(Math.acos(cosHourAngle));
  };

  const atNoon = halfDayMinAt(solarNoonMin);
  if (atNoon === 'never-rises') return { kind: 'sun-never-rises', solarNoonMs };
  if (atNoon === 'never-sets') return { kind: 'sun-never-sets', solarNoonMs };

  /*
   * Refine each event against the declination at that event rather than at
   * transit. Declination moves up to 0.4 deg/day away from the solstices, and
   * sunrise sits about seven hours before transit, so the noon value is roughly
   * 0.09 deg wrong at each end -- about 15 s of clock. It also makes the day
   * legitimately asymmetric about transit, which the single-declination form
   * cannot represent.
   *
   * Two passes converge to well under a second at these latitudes. A pass that
   * strays into a polar result keeps the previous estimate: that can only happen
   * within a hair of the polar boundary, and the noon classification above has
   * already decided the case.
   */
  const refine = (initial: number, sign: 1 | -1): number => {
    let eventMin = initial;
    for (let pass = 0; pass < 2; pass++) {
      const half = halfDayMinAt(eventMin);
      if (typeof half !== 'number') return eventMin;
      eventMin = solarNoonMin + sign * half;
    }
    return eventMin;
  };

  const sunriseMin = refine(solarNoonMin - atNoon, -1);
  const sunsetMin = refine(solarNoonMin + atNoon, 1);

  return {
    kind: 'sun-crosses-horizon',
    sunriseMs: Math.round(midnightMs + sunriseMin * 60_000),
    sunsetMs: Math.round(midnightMs + sunsetMin * 60_000),
    solarNoonMs,
    dayLengthMin: sunsetMin - sunriseMin,
  };
}
