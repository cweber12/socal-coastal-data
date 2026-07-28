import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // lib/ is pure and offline by construction. Nothing under test is allowed to
    // reach the network -- the CO-OPS and NDBC fixtures are captured payloads
    // committed under lib/__fixtures__, so a test that starts needing a live
    // endpoint is a design regression, not a flake.
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
