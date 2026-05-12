-- Phase 5 Billing: payments, wompi_events

-- New table: payments
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`wompi_transaction_id` text NOT NULL,
	`amount_in_cents` integer NOT NULL,
	`currency` text DEFAULT 'COP' NOT NULL,
	`status` text NOT NULL,
	`payment_method` text,
	`plan_id` text,
	`device_count` integer DEFAULT 1 NOT NULL,
	`billing_period_start` integer NOT NULL,
	`billing_period_end` integer NOT NULL,
	`wompi_reference` text,
	`created_at` integer NOT NULL DEFAULT (unixepoch()),
	`updated_at` integer NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payments_wompi_transaction_id` ON `payments` (`wompi_transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_payments_organization_id` ON `payments` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_payments_status` ON `payments` (`organization_id`,`status`);
--> statement-breakpoint

-- New table: wompi_events
CREATE TABLE `wompi_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`wompi_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_wompi_events_event_id` ON `wompi_events` (`wompi_event_id`);
--> statement-breakpoint
CREATE INDEX `idx_wompi_events_organization_id` ON `wompi_events` (`organization_id`);