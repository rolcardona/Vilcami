-- Make device_subscription_id nullable in billing_events (FK to device_subscriptions)
-- A billing event may not always have an associated subscription (e.g., pre-subscription telemetry)
-- SQLite/D1 does not support ALTER COLUMN, so we recreate the table.

ALTER TABLE `billing_events` RENAME TO `_billing_events_old`;

CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_subscription_id` text,
	`event_timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`device_external_id` text NOT NULL,
	`sensor_count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`device_subscription_id`) REFERENCES `device_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);

INSERT INTO `billing_events` (`id`, `organization_id`, `device_subscription_id`, `event_timestamp`, `event_type`, `device_external_id`, `sensor_count`)
	SELECT `id`, `organization_id`, `device_subscription_id`, `event_timestamp`, `event_type`, `device_external_id`, `sensor_count`
	FROM `_billing_events_old`;

DROP TABLE `_billing_events_old`;