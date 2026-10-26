import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Production default is OFF; most suites were written for the rollout state (ON). Strict-mode tests override per request.
    env: { IOS_ALLOW_ACCOUNTLESS_PUBLISH: '1' },
    environment: 'node',
  },
});
