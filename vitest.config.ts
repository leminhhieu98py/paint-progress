import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

loadEnv({ path: '.env.test.local' })

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
})
