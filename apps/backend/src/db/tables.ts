import { sql } from "drizzle-orm";
import { sqliteTable as table } from "drizzle-orm/sqlite-core";
import * as t from "drizzle-orm/sqlite-core";
import type * as Schemas from "@app/schemas";

// DEV_NOTE: SQLite does not have bigInt support

// DEV_NOTE: no `AUTOINCREMENT` anywhere below — see architecture.md §4: it writes to
// sqlite_sequence on every insert for a guarantee (deleted rowids never reused) that's moot once
// every table only ever soft-deletes. `integer primary key` alone is already the SQLite rowid.
// DEV_NOTE: no table declares `references` — see architecture.md §4.1. Relationship columns are
// indexed exactly as if they were constrained; the repository layer validates on write instead.

export const users = table(
  "users",
  {
    id: t.int().primaryKey(),
    publicId: t.text("public_id").notNull(),
    clerkId: t.text("clerk_id").notNull(),
    email: t.text().notNull(),
    role: t.text().$type<Schemas.UserRoleEnum>().notNull(),
    tz: t.text().notNull().default("Asia/Kolkata"),
    homeCurrency: t.text("home_currency").notNull().default("INR"),
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }).notNull(),
    deletedAt: t.integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_users_public_id").on(table.publicId),
    t.uniqueIndex("UNQ_users_clerk_id").on(table.clerkId),
    t.uniqueIndex("UNQ_users_email").on(table.email),
  ],
);

export const notes = table(
  "notes",
  {
    id: t.int().primaryKey({ autoIncrement: true }),
    publicId: t.text("public_id").notNull(),
    userId: t.text("user_id").notNull(),
    title: t.text().notNull(),
    body: t.text(),
    status: t.integer().$type<Schemas.NoteStatusIntEnum>().notNull().default(1), // NoteStatusIntEnum.Draft
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_notes_public_id").on(table.publicId),
    t.index("IDX_notes_user_id").on(table.userId),
  ],
);

// DEV_NOTE: declared globally per user, reused across trackers — see architecture.md §5 "metrics".
export const metrics = table(
  "metrics",
  {
    id: t.int().primaryKey(),
    publicId: t.text("public_id").notNull(),
    userId: t.text("user_id").notNull(),
    key: t.text().notNull(),
    name: t.text().notNull(),
    semanticType: t.text("semantic_type").$type<Schemas.SemanticType>().notNull(),
    canonicalUnit: t.text("canonical_unit").notNull(),
    defaultAgg: t.text("default_agg").$type<Schemas.DefaultAgg>().notNull().default("sum"),
    direction: t.text().$type<Schemas.Direction>().notNull().default("higher_better"),
    dateAttribution: t
      .text("date_attribution")
      .$type<Schemas.DateAttribution>()
      .notNull()
      .default("start"),
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }),
    deletedAt: t.integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_metrics_public_id").on(table.publicId),
    t.uniqueIndex("UNQ_metrics_user_id_key").on(table.userId, table.key),
    t
      .index("IDX_metrics_user_id")
      .on(table.userId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// DEV_NOTE: projects/people/places/etc — the shared "named thing to attach entries to" across every
// domain, linked in via entry_entities' role-scoped join. Live outside trackers so the same entity
// can be referenced from any number of them. See architecture.md §5 "entities".
export const entities = table(
  "entities",
  {
    id: t.int().primaryKey(),
    publicId: t.text("public_id").notNull(),
    userId: t.text("user_id").notNull(),
    kind: t.text().$type<Schemas.EntityKind>().notNull(),
    name: t.text().notNull(),
    emoji: t.text(),
    colorIndex: t.integer("color_index"), // index into the --chart-N categorical scale
    parentId: t.integer("parent_id"),
    status: t.text().$type<Schemas.EntityStatus>(),
    startedOn: t.text("started_on"), // YYYY-MM-DD
    endedOn: t.text("ended_on"),
    sortOrder: t.integer("sort_order").notNull().default(0),
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }),
    archivedAt: t.integer("archived_at", { mode: "timestamp" }),
    deletedAt: t.integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_entities_public_id").on(table.publicId),
    t
      .index("IDX_entities_user_id")
      .on(table.userId)
      .where(sql`${table.deletedAt} is null`),
    t
      .index("IDX_entities_user_id_kind")
      .on(table.userId, table.kind)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// DEV_NOTE: free-form key/value extension on an entity (e.g. a "goal" entity's target_date). No
// independent identity — composite PK, no public_id. See architecture.md §4 "Which tables get a
// public_id". Not read/written by anything yet; the column shape alone is what the doc specifies.
export const entityAttrs = table(
  "entity_attrs",
  {
    entityId: t.integer("entity_id").notNull(),
    key: t.text().notNull(),
    valueNum: t.real("value_num"),
    valueText: t.text("value_text"),
  },
  (table) => [t.primaryKey({ columns: [table.entityId, table.key] })],
);

// DEV_NOTE: a saved configuration — adding a tracker is a row insert, not a deploy. manifest_json
// decides what UI to render (manifest.control) and which metrics to write. See architecture.md §5
// "trackers".
export const trackers = table(
  "trackers",
  {
    id: t.int().primaryKey(),
    publicId: t.text("public_id").notNull(),
    userId: t.text("user_id").notNull(),
    name: t.text().notNull(),
    emoji: t.text(),
    colorIndex: t.integer("color_index"),
    primaryMetricId: t.integer("primary_metric_id").notNull(),
    manifestJson: t
      .text("manifest_json", { mode: "json" })
      .$type<Schemas.TrackerManifest>()
      .notNull(),
    manifestVersion: t.integer("manifest_version").notNull().default(1),
    sortOrder: t.integer("sort_order").notNull().default(0),
    activeFrom: t.text("active_from").notNull(), // YYYY-MM-DD; heatmaps render nothing before this
    activeTo: t.text("active_to"), // set when paused/retired
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }),
    archivedAt: t.integer("archived_at", { mode: "timestamp" }),
    deletedAt: t.integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_trackers_public_id").on(table.publicId),
    t
      .index("IDX_trackers_user_id")
      .on(table.userId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// DEV_NOTE: entries is the append-mostly raw log — the source of truth. entry_values/entry_entities
// (below) carry the actual readings/links; daily_facts is a derived, disposable cache written only
// by EntriesDAL. See architecture.md §5 "entries".
export const entries = table(
  "entries",
  {
    id: t.int().primaryKey(),
    publicId: t.text("public_id").notNull(),
    userId: t.text("user_id").notNull(),
    trackerId: t.integer("tracker_id").notNull(),
    entryKind: t.text("entry_kind").$type<Schemas.EntryKind>().notNull().default("point"),
    occurredAt: t.integer("occurred_at", { mode: "timestamp" }).notNull(), // unix seconds, UTC instant
    endedAt: t.integer("ended_at", { mode: "timestamp" }), // interval end; null+interval = open session
    localDate: t.text("local_date").notNull(), // YYYY-MM-DD, resolved at write time
    tz: t.text().notNull(), // IANA, e.g. 'Asia/Kolkata'
    label: t.text(), // free-text description; drill-down groups on this
    note: t.text(),
    source: t.text().notNull().default("manual"), // manual | manual_retro | import | api
    transferGroupId: t.text("transfer_group_id"), // links the two sides of an account transfer
    rev: t.integer().notNull().default(0), // monotonic; sync ordering key
    createdAt: t.integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: t.integer("updated_at", { mode: "timestamp" }),
    deletedAt: t.integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    t.uniqueIndex("UNQ_entries_public_id").on(table.publicId),
    t
      .index("IDX_entries_user_id_local_date")
      .on(table.userId, table.localDate)
      .where(sql`${table.deletedAt} is null`),
    t
      .index("IDX_entries_tracker_id_local_date")
      .on(table.trackerId, table.localDate)
      .where(sql`${table.deletedAt} is null`),
  ],
);

// DEV_NOTE: one entry, many readings — a habit tap has one row here; a meal has four; a workout set
// has two. No independent identity — composite PK, no public_id.
export const entryValues = table(
  "entry_values",
  {
    entryId: t.integer("entry_id").notNull(),
    metricId: t.integer("metric_id").notNull(),
    valueNum: t.real("value_num"),
    valueText: t.text("value_text"),
    valueJson: t.text("value_json"),
    currency: t.text(), // ISO 4217, currency_minor only
    valueBase: t.real("value_base"), // converted to home currency
    fxRate: t.real("fx_rate"), // rate at entry time
  },
  (table) => [
    t.primaryKey({ columns: [table.entryId, table.metricId] }),
    t.index("IDX_entry_values_metric_id").on(table.metricId, table.entryId),
  ],
);

// DEV_NOTE: one entry, many entities — but one per role. The PK on (entry_id, role) is what
// guarantees a "slice by project" donut sums to exactly 100%.
export const entryEntities = table(
  "entry_entities",
  {
    entryId: t.integer("entry_id").notNull(),
    entityId: t.integer("entity_id").notNull(),
    role: t.text().$type<Schemas.EntryRole>().notNull(),
  },
  (table) => [
    t.primaryKey({ columns: [table.entryId, table.role] }),
    t.index("IDX_entry_entities").on(table.entityId, table.role, table.entryId),
  ],
);

// DEV_NOTE: materialized rollup, upserted by EntriesDAL alongside every entries write/delete — the
// only thing dashboards/aggregations should ever query. No id/publicId: never addressed individually
// by a client, only ever fetched by range query. min/max/avg are nullable — invariant 7: missing
// data is neutral, never coalesced to 0. entityId IS NULL is the canonical, un-attributed total.
export const dailyFacts = table(
  "daily_facts",
  {
    userId: t.text("user_id").notNull(),
    localDate: t.text("local_date").notNull(),
    metricId: t.integer("metric_id").notNull(),
    entityId: t.integer("entity_id"),
    sum: t.real().notNull(),
    count: t.integer().notNull(),
    min: t.real(),
    max: t.real(),
    avg: t.real(),
    targetAtTime: t.real("target_at_time"), // snapshot; keeps history honest when goals change
    updatedAt: t.integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    t.primaryKey({
      columns: [table.userId, table.localDate, table.metricId, table.entityId],
    }),
    t.index("IDX_daily_facts_lookup").on(table.userId, table.metricId, table.localDate),
  ],
);
