import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Empty prefix so non-VITE_ vars (RLS_TEST_*) are exposed too.
Object.assign(process.env, loadEnv('test', process.cwd(), ''))

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
})
