import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `infra/` stays at the repository root: the constrained shell is
    // installed on monitored hosts, so it belongs to neither app.
    include: ['src/**/*.test.ts', '../../infra/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
