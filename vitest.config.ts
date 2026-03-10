import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:test@localhost:5432/testdb',
      REDIS_URL: 'redis://localhost:6379',
      BREET_MOCK: 'true',
      BREET_API_BASE_URL: 'https://api.breet.io',
      SPREAD_PERCENT: '1.5',
      MIN_TX_AMOUNT: '10',
      MAX_TX_AMOUNT: '10000',
      MAX_MESSAGES_PER_MINUTE: '5',
      MAX_TX_PER_DAY: '3',
      MAX_DAILY_VOLUME_NGN: '500000',
    },
  },
});
