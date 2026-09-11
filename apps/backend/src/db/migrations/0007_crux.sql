CREATE TABLE `notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`tracker_reminders_enabled` integer NOT NULL,
	`streak_digest_enabled` integer NOT NULL,
	`streak_digest_hour` integer NOT NULL,
	`open_interval_enabled` integer NOT NULL,
	`open_interval_threshold_minutes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`device_label` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_push_subscriptions_public_id` ON `push_subscriptions` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_push_subscriptions_endpoint` ON `push_subscriptions` (`endpoint`) WHERE "push_subscriptions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `IDX_push_subscriptions_user_id` ON `push_subscriptions` (`user_id`) WHERE "push_subscriptions"."deleted_at" is null;