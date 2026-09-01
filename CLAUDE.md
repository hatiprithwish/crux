# Claude Instructions

> Non-negotiable. Every session. No exceptions.

---

## 1. FOUNDATIONAL OPERATING PRINCIPLES

### Scan Before Code

BEFORE writing any file or code block:

1. Read the existing file tree from project root
2. Open the closest existing golden file that does what you are about to do (see golden file references below)
3. Identify naming conventions, import patterns, and folder placement
4. Only then write — mirroring what already exists

If you have not read at least one existing file in the relevant domain, you are not allowed to write new code. If you cannot find a pre-existing pattern, flag it instead of assuming.

### Golden File References

When implementing any layer, read the corresponding golden file first:

| Layer               | Golden file                                          |
| ------------------- | ---------------------------------------------------- |
| DAL                 | `apps/backend/src/data-access-layer/NotesDAL.ts`     |
| Repository          | `apps/backend/src/repositories/NotesRepo.ts`         |
| Routes              | `apps/backend/src/routes/NotesRoutes.ts`             |
| Frontend data layer | `apps/web/src/routes/_authenticated/notes/-data.ts`  |
| Frontend page       | `apps/web/src/routes/_authenticated/notes/index.tsx` |

### Ambiguity Halt Protocol

If a requirement is unclear OR conflicts with existing architecture:

- STOP
- Ask ONE specific question: "To implement X, I need to know Y. What is Y?"
- Do not guess. Do not pick the "most common" pattern. Ask.

### First-Principles Execution

- NEVER write `// TODO`, `// implement later`, `// placeholder`, or stub functions
- NEVER omit error handling, loading states, or empty states — these are mandatory
- Every feature delivered must be end-to-end functional: data fetches, renders, handles errors, handles empty
- If a function is called somewhere, it must exist and be fully implemented

---

## 2. DEPENDENCY & DOCUMENTATION HYGIENE

### Package Rules

- ALWAYS check `package.json` before referencing any library
- NEVER invent package names or version-guess APIs
- NEVER use a package not already in `package.json` without explicitly proposing it first: "This requires `X@Y`. Add it?"
- If unsure whether a method exists in the installed version, say so and check docs

### Documentation Verification

When implementing anything from a third-party library:

1. Check `package.json` for the installed version
2. Read the relevant file under `llm-context/` — every listed library has one
3. If behavior is still unclear, use the `context7` MCP to fetch current docs for that exact version
4. Write code against verified docs — never against training-data memory of that library
5. If docs cannot be retrieved, state: "I cannot verify current API for `X`. Provide docs or I will halt."

NEVER default to deprecated syntax because it looks familiar. Recency wins over recall.

---

## 3. INTERACTIVE WORKFLOW

### Alignment Checklist (mandatory before any feature spanning more than one file)

Before writing code, output:

```
PLAN:
- Files to create: [list]
- Files to modify: [list]
- Golden file I am mirroring: [file path]
- New packages needed: [none OR "X@Y — add it?"]
- Ambiguities: [none OR single specific question]

Confirm to proceed.
```

Wait for explicit confirmation. Do not proceed without it.

### Complete Implementation

- Deliver all files in one response — no "here is part 1, part 2 coming"
- No partial components. If a component uses a hook, the hook is also delivered
- No "you will need to wire this up yourself" — wiring is part of the implementation

---

## 4. STACK

**Monorepo:** pnpm workspaces

- `apps/web` — TanStack Start (React 19, Vite, Cloudflare Workers)
- `apps/backend` — Hono API (Cloudflare Workers, Drizzle ORM, D1)
- `packages/schemas` — shared Zod schemas + TypeScript types

**Approved packages — use these, never introduce alternatives:**

| Concern        | Package                                                  |
| -------------- | -------------------------------------------------------- |
| Routing        | `@tanstack/react-router` + `@tanstack/react-start`       |
| Server state   | `@tanstack/react-query`                                  |
| Client state   | `zustand`                                                |
| Forms          | `@tanstack/react-form` — NOT react-hook-form             |
| Validation     | `zod` v4                                                 |
| UI components  | shadcn/ui in `src/shadcn/ui/` + Tailwind v4              |
| Icons          | `@phosphor-icons/react`                                  |
| Auth (web)     | `@clerk/tanstack-react-start`                            |
| Auth (worker)  | `@clerk/backend`                                         |
| HTTP (worker)  | Hono v4 + `@hono/zod-validator`                          |
| ORM            | Drizzle ORM with D1 (SQLite)                             |
| Logging        | `@logtape/logtape` via `AppLogger` — never `console.log` |
| Error tracking | Sentry                                                   |
| Testing        | Vitest + React Testing Library                           |
| Linting        | ESLint + Prettier — configs exist, respect them          |

---

## 5. ARCHITECTURE

### Feature structure — every new feature requires ALL layers in this order

**Step 1 — `packages/schemas/src/<feature>/`**

- `<Feature>Common.ts` — Zod schemas + types for DB entities
- `<Feature>ApiRequest.ts` — Zod schemas + types for API request bodies
- `<Feature>ApiResponse.ts` — TypeScript interfaces extending `ApiResponse`
- `<Feature>DALRequest.ts` — TypeScript types for DAL method params
- `index.ts` — re-export everything
- Export from `packages/schemas/src/index.ts`

**Step 2 — `apps/backend/src/`**

- `db/tables.ts` — add Drizzle table definition to existing file
- `data-access-layer/<Feature>DAL.ts` — raw DB operations only
- `repositories/<Feature>Repo.ts` — business logic, maps API shapes to DAL params
- `routes/<Feature>Routes.ts` — Hono routes with auth + zValidator
- `index.ts` — mount: `app.route("/<feature>", <Feature>Routes)`

**Step 3 — `apps/web/src/routes/_authenticated/<feature>/`**

- `-data.ts` — `QueryOptions` class + mutation hooks
- `index.tsx` — list/main page
- `new/index.tsx` — create page (if applicable)
- `$<id>/index.tsx` — detail/edit page (if applicable)
- `-<ComponentName>.tsx` — co-located private components (prefixed with `-`)

### Layer import rules — never skip or reverse

```
Routes → Repo → DAL → DB
```

- Routes call Repo only — never DAL, never Drizzle directly
- Repo calls DAL only — never Drizzle directly
- DAL calls Drizzle only

### New feature checklist

- [ ] Add `LogCategory` and `LogAction` entries in `packages/schemas/src/log.ts`
- [ ] Define `<Feature>StatusIntEnum`, `<Feature>StatusLabelEnum`, `<FEATURE>_STATUS_LABEL_MAP` in `<Feature>Common.ts` for any status field
- [ ] Create `packages/schemas/src/<feature>/` with all 5 files + `index.ts`
- [ ] Export from `packages/schemas/src/index.ts`
- [ ] Add DB table in `apps/backend/src/db/tables.ts`
- [ ] Run `pnpm db:generate` then `pnpm db:migrate`
- [ ] Create `<Feature>DAL.ts`
- [ ] Create `<Feature>Repo.ts`
- [ ] Create `<Feature>Routes.ts`
- [ ] Mount routes in `apps/backend/src/index.ts`
- [ ] Create `-data.ts` in web route folder
- [ ] Create page components

---

## 6. CONVENTIONS

### Status Enum Pattern (mandatory for any field with discrete states)

Every status/state field stored as integer in DB MUST have two enums and both values in the API response.

**`packages/schemas/src/<feature>/<Feature>Common.ts`:**

```ts
export enum NoteStatusIntEnum {
  Draft = 1,
  Published = 2,
  Archived = 3,
}

export enum NoteStatusLabelEnum {
  Draft = "Draft",
  Published = "Published",
  Archived = "Archived",
}

export const NOTE_STATUS_LABEL_MAP: Record<NoteStatusIntEnum, NoteStatusLabelEnum> = {
  [NoteStatusIntEnum.Draft]: NoteStatusLabelEnum.Draft,
  [NoteStatusIntEnum.Published]: NoteStatusLabelEnum.Published,
  [NoteStatusIntEnum.Archived]: NoteStatusLabelEnum.Archived,
};

// DB shape
export type Note = { ..., status: NoteStatusIntEnum };

// API response shape — both int and label
export interface NoteWithStatus extends Note {
  noteStatus: NoteStatusIntEnum;
  noteStatusLabel: NoteStatusLabelEnum;
}
```

**`apps/backend/src/db/tables.ts`:**

```ts
// Use raw integer literal for default — drizzle-kit cannot resolve enum imports at codegen time
status: t.integer().$type<NoteStatusIntEnum>().notNull().default(1), // NoteStatusIntEnum.Draft
```

**`apps/backend/src/repositories/<Feature>Repo.ts` — map int → label here, never in DAL:**

```ts
private withStatusLabel(note: Schemas.Note): Schemas.NoteWithStatus {
  return {
    ...note,
    noteStatus: note.status,
    noteStatusLabel: Schemas.NOTE_STATUS_LABEL_MAP[note.status],
  };
}
```

**Golden example:** see `packages/schemas/src/notes/NotesCommon.ts` and `apps/backend/src/repositories/NotesRepo.ts`

**Rules:**

- DB stores integer only — NEVER store label string in DB
- DAL returns raw int — NEVER add label mapping in DAL
- Repo maps int → label — ALWAYS in `withStatusLabel` private method
- NEVER return raw int without the label counterpart in API response
- Naming: `<Feature>StatusIntEnum`, `<Feature>StatusLabelEnum`, `<FEATURE>_STATUS_LABEL_MAP`
- Response fields: `<feature>Status` (int) + `<feature>StatusLabel` (string), both always present
- Frontend renders label, compares/filters with int enum values

---

### Type ownership

`packages/schemas` is the single source of truth for all types and Zod schemas.

- NEVER define a request or response type in `apps/web` or `apps/backend`
- NEVER duplicate a type that already exists in `packages/schemas`
- If a type is only used in one app today but could cross the boundary, it belongs in `packages/schemas`

### Schema migration

After ANY change to a Drizzle schema file:

1. Run `pnpm db:generate` immediately — not later, not after the next feature
2. Run `pnpm db:migrate` (or `pnpm db:migrate:local` for local dev)
3. Commit the generated migration file alongside the schema change — never in a separate commit

If you write a schema change and do not emit these commands as the next step, the implementation is incomplete.

### Route auth boundary

All authenticated routes MUST be nested under the `_authenticated` route wrapper.

- NEVER create a route that requires user data outside `_authenticated/`
- Before creating any new route: check if it needs auth → if yes, place it under `_authenticated/`
- If unsure whether a route needs auth, ask. Do not assume.

### DB tables

- Use `sqliteTable` aliased as `table`
- Column names: camelCase in code, `snake_case` in DB (`t.text("user_id")`)
- All timestamps: `t.integer({ mode: "timestamp" })` — never text
- Always include `createdAt` (notNull) and `updatedAt` (nullable)
- Add index for all foreign key columns: `t.index("IDX_things_user_id").on(table.userId)`
- Add unique index where needed: `t.uniqueIndex("UNQ_things_field").on(table.field)`

### DAL

- Class with `private db: DrizzleD1Database`
- Constructor takes `env: Env`, calls `getDbClient(env)`
- Every method: initialize `response = { isSuccess: false }`, wrap in try/catch
- On error: call `AppLogger.error({ category, action, message, error, metadata: params })`, set `response.message`
- On success: set `response.isSuccess = true`, populate response fields
- Use `LogCategory` and `LogAction` enums from `@app/schemas`

### Repository

- Class with `private dal: <Feature>DAL`
- Constructor takes `env: Env`
- Thin layer: maps API request shapes to DAL params, business logic lives here
- If any function exceeds 50 lines, extract reusable private functions

### Routes

- `new Hono<AppContext>()`
- Always: `checkAuth` middleware first, then `zValidator` for body/param/query
- Get userId: `c.get("clerkUserId")`
- Status codes: 201 create, 200 success, 404 not found, 500 error
- Instantiate Repo inside handler: `const repo = new <Feature>Repo(c.env)`

### Frontend data layer (`-data.ts`)

- Queries: static class with hierarchical key methods
- Invalidating `keys.all()` invalidates all detail queries automatically
- Use `setQueryData` on update mutations to update cache without refetch
- Use `removeQueries` on delete mutations to remove detail from cache
- Use `mutateAsync` when you need to await before navigating or closing a form
- Use `mutate` when navigation/side effect happens in `onSuccess`
- Always pass `signal` from queryFn into `apiClient`

### Mutation error handling

Every `useMutation` must handle errors explicitly:

```ts
const mutation = useMutation({
  mutationFn: ...,
  onSuccess: () => { /* handle success */ },
  onError: (error) => {
    // surface via shadcn toast — check existing usage before inventing a pattern
  },
})
```

- NEVER leave `onError` absent on a mutation
- NEVER swallow the error silently with an empty `onError: () => {}`
- Use the existing shadcn toast utility — find existing usage in `src/` before writing anything new

### Frontend pages

- Always call `useAuth()` at page level, pass `getToken` into query/mutation hooks
- Loading state: `if (isPending) return <div>Loading...</div>`
- Error state: `if (isError) return <div>Failed to load.</div>`
- Co-located components use `-` prefix (e.g. `-NoteCard.tsx`) — they are not routes
- All API calls go through `apiClient` — never raw fetch in a component

### Styling

- Tailwind utility classes only — no inline `style={{}}` except for dynamic values impossible in Tailwind
- shadcn components used as-is or extended via `className` — never modify files in `src/shadcn/ui/`
- No CSS modules, no styled-components

---

## 7. SELF-REVIEW CHECKLIST

Run this before outputting any code block:

**Type safety**

- [ ] No implicit `any` — every variable and parameter typed
- [ ] No non-null assertions (`!`) without a guard proving non-null
- [ ] All `Promise`-returning functions either awaited or `.catch()`ed
- [ ] No unchecked array index access on user-controlled data

**Architecture alignment**

- [ ] File lives in the correct folder
- [ ] Imports use the same alias/path pattern as neighboring files
- [ ] Naming matches existing conventions (casing, prefix, suffix)
- [ ] No new abstractions introduced unless the task explicitly requires one
- [ ] Layer import rules respected — no skipped or reversed layers

**Logic correctness**

- [ ] All branches covered — no missing `else` on state machines
- [ ] Side effects cleaned up (listeners removed, intervals cleared)
- [ ] No hardcoded values that belong in config/env

If any item fails, fix it before outputting. Do not output and note the failure.

---

## 8. HARD BANS

- NEVER use `console.log` — always `AppLogger`
- NEVER use `any` — use `unknown` and narrow, or proper types from schemas
- NEVER use `@ts-ignore` or `as any` as a fix — fix the type
- NEVER define types or Zod schemas outside `packages/schemas`
- NEVER skip a layer — Routes → Repo → DAL → DB, no exceptions
- NEVER mock data unless explicitly told "mock this"
- NEVER install a package without asking first
- NEVER install a package that has a native browser API equivalent
- NEVER disable ESLint rules inline without asking
- NEVER create a utility that duplicates one already in `src/lib/`
- NEVER write tests that only test the mock, not the behavior
- NEVER place an authenticated route outside `_authenticated/`
- NEVER write a schema change without immediately emitting `db:generate` and `db:migrate`
- NEVER leave `onError` absent or empty on a mutation
- ALWAYS use `pnpm` — never `npm` or `yarn`

---

## 9. COMMANDS

```bash
pnpm dev                              # run all apps
pnpm --filter web dev
pnpm --filter backend dev
pnpm --filter web test
pnpm --filter backend test
pnpm --filter backend db:generate      # generate migration after schema change
pnpm --filter backend db:migrate       # apply migration to remote
pnpm --filter backend db:migrate:local # apply migration to local dev
```

---

> Scan. Verify. Plan. Implement completely. Review against the checklist. Ship nothing broken.
> The repo is the source of truth. Docs are the source of truth. Training memory is a liability.
