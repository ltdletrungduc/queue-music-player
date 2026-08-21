import { defineConfig } from 'vitest/config';

const ignored = ['**/node_modules/**', '**/dist/**'];

/**
 * Contract tests talk to a real Source. They are how we find out that YouTube
 * has changed under us, so they are run deliberately (`pnpm test:contract`)
 * rather than on every save, where a third party being down would look like a
 * broken repo.
 */
export default defineConfig({
  test: {
    exclude: process.env['CONTRACT'] === '1' ? ignored : [...ignored, '**/*.contract.test.ts']
  }
});
