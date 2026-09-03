## Setup

### Frontend (`apps/web`)

- Change worker name in `apps/web/wrangler.jsonc` and `package.json`
- Copy `.env.example` to `.env` and populate it. You will need to create a Sentry project for this, although you can reuse the "Project Token" (Stored in Bitwarden).
- The web worker has **no** runtime secrets — do not run `wrangler secret put` for it. Every `VITE_*` value is inlined into the bundle at build time by Vite (from `.env` locally, from GitHub environment secrets in CI), so a Worker runtime var of the same name is never read.

### Backend (`apps/backend`)

- Change worker name in `apps/backend/wrangler.jsonc` and `package.json`
- Create a D1 database
- Update `database_id` in `apps/backend/wrangler.jsonc` with the returned ID
- Copy `.dev.vars.example` to `.dev.vars` and populate it for local dev
- Add the runtime secrets to each deployed environment. Always go through
  `pnpm --filter backend exec` — a bare `pnpm exec wrangler` from the repo root picks up whatever
  wrangler is installed globally, finds no `wrangler.jsonc` there, and fails with
  _"No environment found in configuration with name staging"_:
  ```bash
  pnpm --filter backend exec wrangler secret put CLERK_PUBLISHABLE_KEY --env staging
  pnpm --filter backend exec wrangler secret put CLERK_SECRET_KEY --env staging
  pnpm --filter backend exec wrangler secret put CLERK_PUBLISHABLE_KEY --env production
  pnpm --filter backend exec wrangler secret put CLERK_SECRET_KEY --env production
  ```
  The target Worker must already exist, so run these _after_ the environment's first deploy.
  Secrets apply immediately — no redeploy needed.
- Run migrations: `pnpm --filter backend db:migrate`

### Run everything

```bash
pnpm install
pnpm dev
```

---

## Deployment

Two environments, `staging` and `production`, each mapped to a git branch and a GitHub
environment of the same name. Pushing to a branch deploys it; there is no other trigger except
the manual **Run workflow** button (`workflow_dispatch`), which is also the rollback path.

| Branch    | GitHub environment | Web worker         | API worker            |
| --------- | ------------------ | ------------------ | --------------------- |
| `staging` | `staging`          | `crux-web-staging` | `crux-worker-staging` |
| `main`    | `production`       | `crux-web`         | `crux-worker`         |

Workflows are path-filtered: `apps/web/**` and `packages/schemas/**` deploy the web worker,
`apps/backend/**` and `packages/schemas/**` deploy the API worker.

Every deploy runs lint → build → typecheck → tests before shipping. The backend test suite is
excluded from CI on purpose — see the DEV_NOTE in `.github/workflows/deploy-worker-*.yml`.

### Required GitHub environment secrets

Set these under **Settings → Environments → `staging`** and **→ `production`**. The web workflow
fails fast if any key from `apps/web/.env.example` is missing.

| Secret                       | staging                                                 | production                                      |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `VITE_API_URL`               | `https://crux-worker-staging.hatiprithwish.workers.dev` | `https://crux-worker.hatiprithwish.workers.dev` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk test key                                          | Clerk live key                                  |
| `VITE_SENTRY_DSN`            | Sentry DSN                                              | Sentry DSN                                      |
| `SENTRY_ORG`                 | Sentry org slug                                         | Sentry org slug                                 |
| `SENTRY_PROJECT`             | `crux`                                                  | `crux`                                          |
| `SENTRY_AUTH_TOKEN`          | Sentry token (source map upload)                        | Sentry token                                    |
| `CLOUDFLARE_API_TOKEN`       | Cloudflare API token                                    | Cloudflare API token                            |
| `CLOUDFLARE_ACCOUNT_ID`      | Cloudflare account ID                                   | Cloudflare account ID                           |

Clerk's **backend** keys are Worker secrets, not GitHub secrets — see the `wrangler secret put`
block above.

### Database

`staging` and `production` currently point at the **same** D1 database (`crux-db`), so staging
deploys read and write production data. Splitting them means creating a second D1 and swapping
`database_id` in the `staging` block of `apps/backend/wrangler.jsonc`.

CI applies migrations before each deploy. After any schema change, run
`pnpm --filter backend db:generate` and commit the generated migration alongside it.

### Deploying by hand

```bash
pnpm --filter backend deploy:staging      # or deploy:production
```

There is deliberately no bare `deploy` script: the top-level `wrangler.jsonc` block sets
`APP_ENV=local`, which bypasses auth, and carries the same worker name as production — an
env-less `wrangler deploy` would overwrite production with an auth-bypassing build.

---

## Tech Stack

- TanStack Start
- Zustand — Lightweight client state management
- tanstack query — Server state & data fetching
- tanstack form — Form state management
- Tailwind CSS — Utility-first CSS framework
- shadcn — Component library (Radix UI + Tailwind)
- Class Variance Authority — CSS variant utility
- clsx — Conditional CSS class utility
- tailwind-merge — Merges Tailwind classes intelligently
- tw-animate-css — Tailwind animation utilities
- @phosphor-icons/react — Icon library
- react-hook-form — Form handling
- @hookform/resolvers — RHF validation resolvers
- Zod — Schema validation & TypeScript types
- @dnd-kit/core — Headless drag-and-drop
- @dnd-kit/sortable — Sortable addon for dnd-kit
- @dnd-kit/utilities — dnd-kit utilities
- @clerk/tanstack-react-start — Clerk auth for TanStack Start
- sonner — Toast notification library
- @sentry/tanstackstart-react — Sentry error tracking
- Cloudflare Workers — Runtime environment
- wrangler — Cloudflare CLI tool
- Vitest — Unit & component testing
- ESLint — Linting
- TypeScript — Type system
- @vitejs/plugin-react — Vite React plugin
- eslint-plugin-react-hooks — React hooks linting
- eslint-plugin-react-x — React best practices linting
- Hono — Lightweight web framework (Cloudflare Workers compatible)
- Cloudflare Workers — Serverless runtime
- wrangler — Cloudflare CLI & local dev server
- Drizzle ORM — Type-safe ORM for D1 (SQLite)
- drizzle-kit — Schema generation & migration tools
- Cloudflare D1 — Serverless SQLite database
- @hono/zod-validator — Zod schema validator middleware for Hono
- @clerk/backend — Clerk backend SDK for token verification
- @logtape/logtape — Structured logging
- @logtape/hono — Hono integration for LogTape
- @logtape/redaction — Sensitive data redaction
- @cloudflare/vitest-pool-workers — Vitest pool for Cloudflare Workers
- typescript-eslint — TypeScript linting
- Prettier — Code formatter
- eslint-config-prettier — Disables conflicting ESLint rules
- Husky — Git hook runner
- lint-staged — Run linters on staged files
