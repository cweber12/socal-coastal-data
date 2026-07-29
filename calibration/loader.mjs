/**
 * Registers calibration/ts-resolve.mjs, then gets out of the way.
 *
 * Passed to `node --import ./calibration/loader.mjs`, so the hook is installed
 * for the calibration run and for nothing else. Next, vitest and `tsc` never
 * load this file.
 */

import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
