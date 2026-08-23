import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Empty prefix so non-VITE_ vars (RLS_TEST_*) are exposed too.
Object.assign(process.env, loadEnv('test', process.cwd(), ''))

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    // Purges what the RLS suite leaves in the live project, via this file's
    // exported `teardown`. No-ops when the RLS credentials are absent, so an
    // ordinary unit-test run is unaffected.
    globalSetup: ['./tests/global-setup.ts'],
  },
})
