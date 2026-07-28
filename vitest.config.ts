import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),

      /*
       * `server-only` resolved to its own empty module, which is exactly what
       * the `react-server` export condition resolves to.
       *
       * Without this, lib/upstream.ts and lib/grid.ts cannot be imported here at
       * all. The package's `exports` map sends every condition except
       * `react-server` to index.js, whose entire body is a `throw`, and vitest
       * runs under `node`. That left 712 lines carrying the failure policy this
       * repo cares most about -- predictions fatal, swell not, drift surfaced,
       * substitution disclosed -- as the only untested part of the codebase,
       * while the pure modules underneath had 180 tests.
       *
       * This changes nothing about the enforcement. `server-only` protects
       * against a CLIENT component importing server code, and that check happens
       * in the Next build, which still resolves the real package. A test runner
       * is not a client bundle, and pointing it at the same empty module the
       * server condition uses is the honest resolution rather than a hole.
       */
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    // lib/ is pure and offline by construction. Nothing under test is allowed to
    // reach the network -- the CO-OPS and NDBC fixtures are captured payloads
    // committed under lib/__fixtures__, so a test that starts needing a live
    // endpoint is a design regression, not a flake.
    //
    // lib/upstream.ts and lib/grid.ts do fetch, and their tests stub global
    // fetch rather than reaching out. upstream.test.ts asserts that the stub was
    // never called for cases that must not issue a request at all, which is the
    // only way to prove a short-circuit actually short-circuits.
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
