// GENERATED FILE -- do not edit by hand.
//
// Generator: scripts/gen-unresolved-sources.mjs
// Regen:     npm run gen:unresolved      Verify: npm run gen:unresolved:check
//
// Every `unresolved` array under shared/, core/zones/ and activities/, found by
// walking those directories rather than by anyone remembering to add a line.
// 5 JSON files and 1 module that originate one.
//
// The entries are IMPORTED, never copied. There is no second wording of any
// caveat in this file for the first one to drift from -- which is what lets
// core/components/unresolved.tsx promise a reader that it quotes the files
// verbatim.
//
// This file says WHICH sources exist. app/unresolved-sources.ts says what each
// one is called and in what order they are argued, and a source it does not
// name still renders. Adding a data file with an `unresolved` array requires no
// edit to either.

import sharedGateHoursJson from '@/shared/gate-hours.json';
import sharedIntertidalJson from '@/shared/intertidal.json';
import sharedSpotsJson from '@/shared/spots.json';
import sharedThresholdsJson from '@/shared/thresholds.json';
import activitiesSurfThresholdsJson from '@/activities/surf/thresholds.json';
import { SURF_ZONE_UNRESOLVED } from '@/core/zones/surf';

/** One discovered source. `version` is null where the source is a module, which has none. */
export interface DiscoveredUnresolved {
  /** Repo-relative path, so a reader can go and read the whole thing. */
  file: string;
  version: string | null;
  entries: readonly string[];
}

export const DISCOVERED_UNRESOLVED: readonly DiscoveredUnresolved[] = [
  { file: 'shared/gate-hours.json', version: sharedGateHoursJson.version, entries: sharedGateHoursJson.unresolved },
  { file: 'shared/intertidal.json', version: sharedIntertidalJson.version, entries: sharedIntertidalJson.unresolved },
  { file: 'shared/spots.json', version: sharedSpotsJson.version, entries: sharedSpotsJson.unresolved },
  { file: 'shared/thresholds.json', version: sharedThresholdsJson.version, entries: sharedThresholdsJson.unresolved },
  { file: 'activities/surf/thresholds.json', version: activitiesSurfThresholdsJson.version, entries: activitiesSurfThresholdsJson.unresolved },
  { file: 'core/zones/surf.ts', version: null, entries: SURF_ZONE_UNRESOLVED },
];
