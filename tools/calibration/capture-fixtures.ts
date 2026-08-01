/**
 * Capture the committed offline fixture set.
 *
 *   node --import ./calibration/loader.mjs calibration/capture-fixtures.ts
 *
 * A deliberate cc0/cc-by-only capture, byte-for-byte as the endpoints served
 * it, restricted to FIXTURE_CORPUS_START onward. Roughly a third of the corpus
 * is All Rights Reserved or No Derivatives and cannot be redistributed at all,
 * so a fixture set that mirrored the real pull would be a licence violation
 * wearing a test's clothes.
 *
 * Filtering committed rows to CC-only while COMPUTING on everything was rejected
 * in #30 and the reasoning holds here: the committed artifact would then not
 * reproduce the published number, which is worse than committing nothing,
 * because it looks like it should. This capture is honest about being a
 * different, smaller corpus -- the run that reads it says so in its header and
 * cannot write shared/calibration.json.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { pullSpot } from './src/acquire.ts';
import {
  FIXTURE_CORPUS_START,
  FIXTURE_LICENCES,
  SENSITIVITY_RADII_KM,
} from './src/config.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const OUT = `${HERE}__fixtures__`;

const taxa = JSON.parse(await readFile(`${REPO}shared/target_taxa.json`, 'utf8'));
const ids = [...taxa.targets, ...taxa.denominator].map((t: { taxon_id: number }) => t.taxon_id);

/*
 * The intertidal members, joined to the inventory on slug, throwing on a member
 * that does not resolve. Same shape as run.ts and for the same reason: the old
 * filter on `tidepool_floor_ft !== null` would match nothing now that the field
 * lives in shared/intertidal.json, and this would capture fixtures for zero
 * spots without failing.
 */
const inventory = JSON.parse(await readFile(`${REPO}shared/spots.json`, 'utf8')).spots as {
  slug: string;
  lat: number;
  lon: number;
}[];
const members = JSON.parse(await readFile(`${REPO}shared/intertidal.json`, 'utf8')).membership
  .members as { slug: string }[];

const spots = members.map((member) => {
  const spot = inventory.find((s) => s.slug === member.slug);
  if (!spot) throw new Error(`intertidal.json member '${member.slug}' is not in spots.json`);
  return spot;
});

const pulledAt = new Date().toISOString().slice(0, 10);

for (const spot of spots) {
  const pull = await pullSpot(
    {
      slug: spot.slug,
      lat: spot.lat,
      lon: spot.lon,
      radiusKm: Math.max(...SENSITIVITY_RADII_KM),
      taxonIds: ids,
      since: FIXTURE_CORPUS_START,
      licenses: FIXTURE_LICENCES,
    },
    pulledAt,
  );
  const path = `${OUT}/inat-${spot.slug}-cc.json`;
  await writeFile(path, JSON.stringify(pull), 'utf8');
  console.log(`${spot.slug.padEnd(20)} ${String(pull.results.length).padStart(4)} records, ${pull.pages} page(s)`);
}
