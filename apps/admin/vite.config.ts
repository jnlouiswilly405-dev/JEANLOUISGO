import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development /api is proxied to the backend (default :4000). For deployed builds set VITE_API_BASE_URL
// and add the app origin to the backend CORS_ORIGINS.
export default defineConfig({
  plugins: [react()],
  server: { port: 5176, proxy: { '/api': process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000' } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
