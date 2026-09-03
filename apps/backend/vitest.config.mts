import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
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
    // DEV_NOTE: D1 is bound `remote: true` (see wrangler.jsonc) — every query in these tests is a
    // real network round trip to Cloudflare, and a single writeEntry now fans out across
    // entries/entry_values/entry_entities/daily_facts. The 5s default is too tight for that.
    testTimeout: 20000,
    // DEV_NOTE: same reasoning as testTimeout above, but for beforeAll/beforeEach — a hook that
    // itself does several remote round trips (e.g. Time's breakdown test seeding three start+stop
    // pairs) can outlast the 10s default even though no single request is slow on its own.
    hookTimeout: 30000,
    // DEV_NOTE: running test files in parallel means N workers open N simultaneous remote
    // connections to the same D1 database — that's what was producing "Network connection lost" /
    // worker-hung errors, not application bugs. One file at a time is the trade the remote binding
    // forces on us.
    fileParallelism: false,
  },
});
