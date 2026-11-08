import { bindings, defineConfig } from 'cf/config';

// Build first with npm run build. scripts/deploy.mjs reads deployment.json
// for the custom hostname and APP_ORIGIN / ADDITIONAL_APP_ORIGINS text bindings.
// Photos and relational records are private bindings.
export default defineConfig({
  worker: {
    name: 'sciapp',
    entrypoint: './dist/worker.js',
    compatibilityDate: '2026-11-08',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    previewUrls: false,
    observability: { enabled: true, traces: { enabled: true }, logs: { enabled: true, invocationLogs: false }, redactQueryString: true },
    env: {
      DB: bindings.d1({ name: 'sciapp-poc' }),
      PHOTOS: bindings.r2({ name: 'sciapp-poc-photos' }),
      AI: bindings.ai(),
      CLERK_PUBLISHABLE_KEY: bindings.secret(),
      CLERK_SECRET_KEY: bindings.secret(),
      VAPID_PUBLIC_KEY: bindings.secret(),
      VAPID_PRIVATE_KEY: bindings.secret(),
    },
  },
});
