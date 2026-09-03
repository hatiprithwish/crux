// DEV_NOTE: these are secrets set via `wrangler secret put` / .dev.vars, not wrangler.jsonc `vars` —
// `wrangler types` can't see them, so they're declared here by hand. Merges with the generated
// `interface Env` in worker-configuration.d.ts since this file has no top-level import/export.
interface Env {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  // DEV_NOTE: only ever read when APP_ENV === "local" (see AuthMiddleware.ts) — unset in staging/production.
  DEV_USER_ID?: string;
}

// DEV_NOTE: cloudflare:test's `env` export is typed via the namespaced Cloudflare.Env, not the
// bare global Env above — augment both so secrets type-check in both places.
declare namespace Cloudflare {
  interface Env {
    CLERK_PUBLISHABLE_KEY: string;
    CLERK_SECRET_KEY: string;
    DEV_USER_ID?: string;
  }
}
