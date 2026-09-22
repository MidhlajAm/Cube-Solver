import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The solver builds its lookup tables on first use; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
