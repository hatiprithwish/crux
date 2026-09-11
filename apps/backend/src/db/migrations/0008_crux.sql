CREATE TABLE `notification_sends` (
	`user_id` text NOT NULL,
	`dedup_key` text NOT NULL,
	`trigger` text NOT NULL,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `dedup_key`)
);
--> statement-breakpoint
ALTER TABLE `trackers` ADD `reminder_hour` integer;--> statement-breakpoint
CREATE INDEX `IDX_trackers_reminder_hour` ON `trackers` (`reminder_hour`,`user_id`) WHERE "trackers"."reminder_hour" is not null and "trackers"."deleted_at" is null;