import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['bench-audit.mts', 'bench-payload.mts', 'bench-parse.mts'],
    environment: 'node',
    testTimeout: 120_000,
  },
})
