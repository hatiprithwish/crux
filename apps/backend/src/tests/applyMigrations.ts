import { beforeAll } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

// DEV_NOTE: imported lazily inside beforeAll, not at module top — a static import of
// "cloudflare:test" here loads the worker graph before each test file's hoisted vi.mock calls run,
// so the Clerk and logger mocks silently stop applying and every authenticated request 401s.
beforeAll(async () => {
  const { applyD1Migrations, env } = await import("cloudflare:test");
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
