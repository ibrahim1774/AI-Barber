import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Production default is OFF; most suites were written for the rollout state (ON). Strict-mode tests override per request.
    env: { IOS_ALLOW_ACCOUNTLESS_PUBLISH: '1', SERVICE_COPY_SIGNING_SECRET: 'test-signing-secret-0123456789abcdef' },
    environment: 'node',
  },
});
