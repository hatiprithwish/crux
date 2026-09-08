ALTER TABLE `metrics` RENAME COLUMN "direction" TO "default_direction";--> statement-breakpoint
-- Direction moved from the metric onto the tracker's manifest: it is a judgement about a habit
-- ("is 30 minutes a floor or a ceiling?"), not a property of the quantity, and one global metric
-- cannot answer it for two trackers that disagree. The metric column survives as the default a new
-- tracker inherits and as what the cross-tracker rollup reads.
--
-- Every existing tracker therefore inherits the direction its primary metric already held. Without
-- this, a money tracker whose metric said lower_better would silently start scoring spending as a
-- win the moment the manifest became the source of truth.
UPDATE `trackers`
SET `manifest_json` = json_set(
  `manifest_json`,
  '$.direction',
  (SELECT `default_direction` FROM `metrics` WHERE `metrics`.`id` = `trackers`.`primary_metric_id`)
)
WHERE json_extract(`manifest_json`, '$.direction') IS NULL
  AND EXISTS (SELECT 1 FROM `metrics` WHERE `metrics`.`id` = `trackers`.`primary_metric_id`);
