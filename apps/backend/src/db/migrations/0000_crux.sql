CREATE TABLE `daily_facts` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`metric_id` integer NOT NULL,
	`entity_id` integer,
	`sum` real NOT NULL,
	`count` integer NOT NULL,
	`min` real,
	`max` real,
	`avg` real,
	`target_at_time` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`, `metric_id`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `IDX_daily_facts_lookup` ON `daily_facts` (`user_id`,`metric_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`color_index` integer,
	`parent_id` integer,
	`status` text,
	`started_on` text,
	`ended_on` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_entities_public_id` ON `entities` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_entities_user_id` ON `entities` (`user_id`) WHERE "entities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `IDX_entities_user_id_kind` ON `entities` (`user_id`,`kind`) WHERE "entities"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `entity_attrs` (
	`entity_id` integer NOT NULL,
	`key` text NOT NULL,
	`value_num` real,
	`value_text` text,
	PRIMARY KEY(`entity_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tracker_id` integer NOT NULL,
	`entry_kind` text DEFAULT 'point' NOT NULL,
	`occurred_at` integer NOT NULL,
	`ended_at` integer,
	`local_date` text NOT NULL,
	`tz` text NOT NULL,
	`label` text,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`transfer_group_id` text,
	`rev` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_entries_public_id` ON `entries` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_entries_user_id_local_date` ON `entries` (`user_id`,`local_date`) WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `IDX_entries_tracker_id_local_date` ON `entries` (`tracker_id`,`local_date`) WHERE "entries"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `entry_entities` (
	`entry_id` integer NOT NULL,
	`entity_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`entry_id`, `role`)
);
--> statement-breakpoint
CREATE INDEX `IDX_entry_entities` ON `entry_entities` (`entity_id`,`role`,`entry_id`);--> statement-breakpoint
CREATE TABLE `entry_values` (
	`entry_id` integer NOT NULL,
	`metric_id` integer NOT NULL,
	`value_num` real,
	`value_text` text,
	`value_json` text,
	`currency` text,
	`value_base` real,
	`fx_rate` real,
	PRIMARY KEY(`entry_id`, `metric_id`)
);
--> statement-breakpoint
CREATE INDEX `IDX_entry_values_metric_id` ON `entry_values` (`metric_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`semantic_type` text NOT NULL,
	`canonical_unit` text NOT NULL,
	`default_agg` text DEFAULT 'sum' NOT NULL,
	`direction` text DEFAULT 'higher_better' NOT NULL,
	`date_attribution` text DEFAULT 'start' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_metrics_public_id` ON `metrics` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_metrics_user_id_key` ON `metrics` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `IDX_metrics_user_id` ON `metrics` (`user_id`) WHERE "metrics"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_notes_public_id` ON `notes` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_notes_user_id` ON `notes` (`user_id`);--> statement-breakpoint
CREATE TABLE `trackers` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`color_index` integer,
	`primary_metric_id` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`manifest_version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active_from` text NOT NULL,
	`active_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`archived_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_trackers_public_id` ON `trackers` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_trackers_user_id` ON `trackers` (`user_id`) WHERE "trackers"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`clerk_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`tz` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`home_currency` text DEFAULT 'INR' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_users_public_id` ON `users` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_users_clerk_id` ON `users` (`clerk_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_users_email` ON `users` (`email`);