import { defineConfig } from 'vitest/config';

// Unit tests run from TypeScript sources only. Vitest 5 no longer excludes the compiled
// `dist/` output (which CI produces before testing), so the include is explicit.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
