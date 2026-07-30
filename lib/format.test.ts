import { describe, expect, it } from 'vitest';

import { formatThreshold, MINUS } from './format';

describe('formatThreshold', () => {
  /*
   * The defect this exists for. shared/spots.json 1.4.0 sets sunset-cliffs to
   * 0.25 ft, and the one-decimal formatHeight rendered it "0.3" -- a label MORE
   * permissive than the predicate it describes, so a 0.28 ft low read as passing
   * while evaluateWindow failed it as above-floor.
   */
  it('renders a quarter-foot threshold exactly, where one decimal could not', () => {
    expect(formatThreshold(0.25)).toBe('0.25');
    expect(formatThreshold(0.75)).toBe('0.75');
    expect(formatThreshold(1.25)).toBe('1.25');
  });

  it('never claims precision a round value has not got', () => {
    // Two decimals everywhere would print "1.00 ft floor", which reads as a
    // surveyed figure. Exactly one trailing zero is trimmed, so the floor never
    // drops below one decimal either.
    expect(formatThreshold(1)).toBe('1.0');
    expect(formatThreshold(0)).toBe('0.0');
    expect(formatThreshold(3)).toBe('3.0');
    expect(formatThreshold(0.5)).toBe('0.5');
  });

  it('uses a true minus sign, matching formatHeight', () => {
    expect(formatThreshold(-0.5)).toBe(`${MINUS}0.5`);
    expect(formatThreshold(-0.25)).toBe(`${MINUS}0.25`);
    expect(formatThreshold(-2.5)).toBe(`${MINUS}2.5`);
  });

  it('does not render a near-zero threshold as below the datum', () => {
    // "−0.0" reads as under-datum when it is not. The same trap formatFloorGap
    // guards at its own coarser precision.
    expect(formatThreshold(-0.001)).toBe('0.0');
    expect(formatThreshold(-0.004)).toBe('0.0');
    expect(formatThreshold(0.001)).toBe('0.0');
  });

  it('covers every edge in the shipped bin scheme', () => {
    // BIN_EDGES_FT as of PR #71. Every one must survive a round trip through the
    // formatter, because rate-panel labels bands with these.
    const edges = [-2.5, -1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 3];
    const rendered = edges.map(formatThreshold);
    expect(rendered).toEqual([
      `${MINUS}2.5`,
      `${MINUS}1.0`,
      `${MINUS}0.5`,
      '0.0',
      '0.25',
      '0.5',
      '0.75',
      '1.0',
      '1.25',
      '1.5',
      '3.0',
    ]);
    // And no two distinct edges collide, which is what made "0.3 to 0.5" wrong.
    expect(new Set(rendered).size).toBe(edges.length);
  });

  it('renders every floor in force, exactly', () => {
    // shared/spots.json 1.4.0. If a future ceiling lands on a value this cannot
    // render, that is the bug reopening.
    expect(formatThreshold(1)).toBe('1.0'); // cabrillo-tidepools, windansea, cardiff-reef
    expect(formatThreshold(0.25)).toBe('0.25'); // sunset-cliffs
    expect(formatThreshold(0)).toBe('0.0'); // swamis
    expect(formatThreshold(0.9)).toBe('0.9'); // torrey-pines-beach
    expect(formatThreshold(0.8)).toBe('0.8'); // la-jolla-shores
    expect(formatThreshold(1.1)).toBe('1.1'); // la-jolla-cove
  });
});
