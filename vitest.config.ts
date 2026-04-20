import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Tests run inside workerd (real CF Workers runtime), not Node.
// See https://developers.cloudflare.com/workers/testing/vitest-integration/
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Dev mode adapter — tests не требуют реальных платежей
        bindings: {
          ENVIRONMENT: 'test',
          PAYMENT_MODE: 'dev',
        },
      },
    }),
  ],
});
