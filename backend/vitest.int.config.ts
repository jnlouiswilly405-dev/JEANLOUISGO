import { defineConfig } from 'vitest/config';

// PostgreSQL-backed integration tests. Run with: DATABASE_URL=... npm run test:int
// Files run sequentially because they share one database.
export default defineConfig({
  test: {
    include: ['integration/**/*.int.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
