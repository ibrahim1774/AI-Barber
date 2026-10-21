// One time zone for every run, so date tests (the reminders' DST crossing) mean the same on any machine.
process.env.TZ = 'America/New_York';

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^expo-secure-store$': '<rootDir>/test/mocks/secure-store.ts',
    '^expo-sqlite/kv-store$': '<rootDir>/test/mocks/kv.ts',
    '^expo-sqlite$': '<rootDir>/test/mocks/sqlite.ts',
    '^@/lib/analytics$': '<rootDir>/test/mocks/analytics.ts',
    '^@/lib/supabase$': '<rootDir>/test/mocks/supabase.ts',
    '^expo-image-manipulator$': '<rootDir>/test/mocks/image-manipulator.ts',
    '^expo-image-picker$': '<rootDir>/test/mocks/image-picker.ts',
    '^expo-crypto$': '<rootDir>/test/mocks/crypto.ts',
    '^expo-superwall$': '<rootDir>/test/mocks/superwall.ts',
    '^expo-notifications$': '<rootDir>/test/mocks/notifications.ts',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
