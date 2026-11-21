// Vitest settings for the offline unit tests (`npm test`). Nothing here needs a browser: the package builds transactions and calls `fetch`, both available in Node.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node's own globals (`fetch`, `Response`, `TextEncoder`), not a simulated DOM.
    environment: 'node',
    // Only files under tests/ that end in `.test.ts` are run.
    include: ['tests/**/*.test.ts'],
  },
})
