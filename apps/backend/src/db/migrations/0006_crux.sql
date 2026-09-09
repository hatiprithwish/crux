CREATE TABLE `tracker_targets` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tracker_id` integer NOT NULL,
	`effective_from` text NOT NULL,
	`target` real,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_tracker_targets_public_id` ON `tracker_targets` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `UNQ_tracker_targets_tracker_id_effective_from` ON `tracker_targets` (`tracker_id`,`effective_from`) WHERE "tracker_targets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `IDX_tracker_targets_tracker_id` ON `tracker_targets` (`tracker_id`,`effective_from`) WHERE "tracker_targets"."deleted_at" is null;--> statement-breakpoint
-- Scoring now reads tracker_targets, not manifest_json, so a tracker with no row here has no
-- target on any day and every logged day scores as met. Seed one row per existing tracker at its
-- active_from, carrying the target it holds today: mechanical, and it leaves every history exactly
-- as it renders right now.
--
-- Deliberately NOT clever. The honest row for a tracker whose owner set a goal three weeks in is
-- "no target from active_from, this target from the day they set it" — and the day they set it is
-- not recorded anywhere, so guessing it would be inventing history to fix a complaint about
-- invented history. The target-history panel on the tracker page is where that gets corrected, one
-- tracker at a time, by the person who knows.
--
-- Archived trackers are seeded too: archiving is reversible, and a restored tracker whose history
-- had no targets would read as all-met from the day it came back.
INSERT INTO `tracker_targets` (
  `public_id`, `user_id`, `tracker_id`, `effective_from`, `target`, `created_at`
)
SELECT
  'trt_' || substr(lower(hex(randomblob(16))), 1, 21),
  `user_id`,
  `id`,
  `active_from`,
  json_extract(`manifest_json`, '$.target'),
  unixepoch()
FROM `trackers`
WHERE `deleted_at` IS NULL;