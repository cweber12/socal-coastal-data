/**
 * An ESM resolve hook that lets Node import this repo's `lib/` modules.
 *
 * The problem is small and entirely about who resolves what. `lib/` is written
 * for Next and for vitest, both of which are bundler-style resolvers, so it
 * imports `'./time'` with no extension. Node's ESM resolver is the runtime one:
 * a specifier must name the file that exists. So `node calibration/run.ts`
 * loads lib/tide.ts, which imports './time', and stops.
 *
 * Three ways out, and this is the third:
 *
 *   Add a dependency (tsx, ts-node). Issue #32 says no new dependencies, and
 *   this repo's whole argument is that it carries no weight it does not need.
 *
 *   Rewrite lib/'s imports to carry `.ts`. That works, but it edits nine
 *   application modules to serve a script, and leaves the repo with two import
 *   conventions and no visible reason for either.
 *
 *   Resolve it at the boundary, here. `lib/` is untouched, Next and vitest never
 *   see this, and the one place that needs runtime resolution is the one place
 *   that asks for it.
 *
 * Deliberately narrow. It rewrites a specifier only when all three hold: it is
 * relative, it has no extension at all, and the exact file `<specifier>.ts`
 * exists on disk. Anything else -- a bare package name, a directory import, a
 * specifier with an extension already, a `.ts` that is not there -- goes
 * straight to the default resolver and fails the way it would have failed
 * anyway. A hook that guessed harder than this could silently resolve a typo to
 * the wrong module.
 *
 * Registered by calibration/loader.mjs, which is passed to `node --import`.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `./time` yes; `./time.ts`, `./time.js`, `node:fs`, `vitest` no. */
const EXTENSIONLESS_RELATIVE = /^\.{1,2}\/(?!.*\.[A-Za-z0-9]+$).+$/;

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && EXTENSIONLESS_RELATIVE.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
