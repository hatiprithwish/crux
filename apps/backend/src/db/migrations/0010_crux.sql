CREATE TABLE `tracker_moments` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tracker_id` integer NOT NULL,
	`plan_id` integer,
	`moment_outcome` integer NOT NULL,
	`local_date` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_tracker_moments_public_id` ON `tracker_moments` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_tracker_moments_tracker_id_local_date` ON `tracker_moments` (`tracker_id`,`local_date`) WHERE "tracker_moments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `IDX_tracker_moments_plan_id` ON `tracker_moments` (`plan_id`) WHERE "tracker_moments"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `tracker_plans` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tracker_id` integer NOT NULL,
	`cue` text NOT NULL,
	`response` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_tracker_plans_public_id` ON `tracker_plans` (`public_id`);--> statement-breakpoint
CREATE INDEX `IDX_tracker_plans_tracker_id` ON `tracker_plans` (`tracker_id`,`sort_order`) WHERE "tracker_plans"."deleted_at" is null;