/**
 * Capture the multi-page cursoring fixture.
 *
 *   node --import ./calibration/loader.mjs calibration/capture-multipage.ts
 *
 * Separate from capture-fixtures.ts and for one reason: the offline pipeline
 * fixtures are a single year, and a single year of the cc-licensed tenth of the
 * corpus is 99 records across eight spots -- one page each, so it never walks
 * the cursor at all. That is exactly the property #32 asks to be asserted
 * against a fixture "whose size exceeds one page".
 *
 * Cabrillo cc0/cc-by from 2016 is 368 records, which is two pages at per_page
 * 200. It needs no tide series, because what it proves is that the walk is
 * complete and strictly ordered -- not anything about the join.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { pullSpot } from './src/acquire.ts';
import { CORPUS_START, FIXTURE_LICENCES, SENSITIVITY_RADII_KM } from './src/config.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

const taxa = JSON.parse(await readFile(`${REPO}shared/target_taxa.json`, 'utf8'));
const ids = [...taxa.targets, ...taxa.denominator].map((t: { taxon_id: number }) => t.taxon_id);

const pull = await pullSpot(
  {
    slug: 'cabrillo-tidepools',
    lat: 32.669,
    lon: -117.245,
    radiusKm: Math.max(...SENSITIVITY_RADII_KM),
    taxonIds: ids,
    since: CORPUS_START,
    licenses: FIXTURE_LICENCES,
  },
  new Date().toISOString().slice(0, 10),
);

await writeFile(
  `${HERE}__fixtures__/inat-cabrillo-cc-multipage.json`,
  JSON.stringify(pull),
  'utf8',
);
console.log(
  `records ${pull.results.length}, pages ${pull.pages}, iNaturalist total ${pull.totalResults}`,
);
