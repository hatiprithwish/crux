import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig(async () => {
  // DEV_NOTE: wrangler.jsonc binds DB `remote: true` to the one physical D1 that local, staging and
  // production all share, so a remote test run writes fixtures straight into production. Tests run
  // against a local Miniflare D1 instead, rebuilt from the checked-in migrations on every run — which
  // also means every migration is exercised end-to-end before it is ever applied remotely.
  const migrations = await readD1Migrations(path.resolve(import.meta.dirname, "./src/db/migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        remoteBindings: false,
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
        "@app/schemas": path.resolve(import.meta.dirname, "../../packages/schemas/src/index.ts"),
      },
    },
    test: {
      include: ["src/**/*.{test,spec}.ts"],
      setupFiles: ["./src/tests/applyMigrations.ts"],
      testTimeout: 20000,
      hookTimeout: 30000,
      fileParallelism: false,
    },
  };
});
