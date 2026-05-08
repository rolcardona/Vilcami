CREATE TABLE `alert_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`alert_lifecycle_id` text NOT NULL,
	`action` text NOT NULL,
	`performed_by` text,
	`timestamp` integer NOT NULL,
	`details` text,
	FOREIGN KEY (`alert_lifecycle_id`) REFERENCES `alert_lifecycle`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by`) REFERENCES `organization_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `alert_escalations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`alert_lifecycle_id` text NOT NULL,
	`escalated_to_member_id` text NOT NULL,
	`escalation_level` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer NOT NULL,
	`acknowledged_at` integer,
	FOREIGN KEY (`alert_lifecycle_id`) REFERENCES `alert_lifecycle`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`escalated_to_member_id`) REFERENCES `organization_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `alert_lifecycle` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`alert_rule_id` text NOT NULL,
	`status` text NOT NULL,
	`triggered_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`returned_to_normal_at` integer,
	`shelved_until` integer,
	`suppression_reason` text,
	`out_of_service_approved_by` text,
	FOREIGN KEY (`alert_rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `organization_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_id` text,
	`sensor_id` text,
	`rule_name` text NOT NULL,
	`severity` text NOT NULL,
	`condition_operator` text NOT NULL,
	`threshold_value` real NOT NULL,
	`threshold_value_max` real,
	`deadband_value` real DEFAULT 2 NOT NULL,
	`time_delay_seconds` integer DEFAULT 0 NOT NULL,
	`channels` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`maintenance_window_start` integer,
	`maintenance_window_end` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sensor_id`) REFERENCES `device_sensors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_subscription_id` text NOT NULL,
	`event_timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`device_external_id` text NOT NULL,
	`sensor_count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`device_subscription_id`) REFERENCES `device_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `compliance_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`template_id` text NOT NULL,
	`generated_at` integer NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`report_type` text NOT NULL,
	`status` text NOT NULL,
	`pdf_url` text,
	`data` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `compliance_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `compliance_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`regulation` text NOT NULL,
	`country_code` text NOT NULL,
	`thresholds` text NOT NULL,
	`report_schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sensor_id` text NOT NULL,
	`date_bucket` text NOT NULL,
	`avg_value` real NOT NULL,
	`min_value` real NOT NULL,
	`max_value` real NOT NULL,
	`std_dev` real,
	`sample_count` integer NOT NULL,
	`alert_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device_sensors` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`sensor_type` text NOT NULL,
	`unit` text NOT NULL,
	`min_threshold` real,
	`max_threshold` real,
	`is_alertable` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`trial_starts_at` integer,
	`trial_ends_at` integer,
	`current_period_start` integer,
	`current_period_end` integer,
	`add_ons` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`device_external_id` text NOT NULL,
	`protocol_type` text NOT NULL,
	`location` text,
	`latitude` real,
	`longitude` real,
	`status` text DEFAULT 'offline' NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hourly_averages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sensor_id` text NOT NULL,
	`hour_bucket` integer NOT NULL,
	`avg_value` real NOT NULL,
	`min_value` real NOT NULL,
	`max_value` real NOT NULL,
	`sample_count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`supabase_user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_at` integer,
	`joined_at` integer,
	`suspended_at` integer,
	`suspended_reason` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country_code` text NOT NULL,
	`currency_code` text NOT NULL,
	`d1_database_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency_code` text NOT NULL,
	`price_per_device_cents` integer NOT NULL,
	`events_included` integer NOT NULL,
	`overage_price_per_hundred_cents` integer NOT NULL,
	`features` text NOT NULL,
	`trial_days` integer DEFAULT 30 NOT NULL,
	`max_trial_devices` integer DEFAULT 3 NOT NULL,
	`is_trial_plan` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weather_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`temperature_celsius` real,
	`humidity_percent` real,
	`wind_speed_kmh` real,
	`weather_code` integer,
	`fetched_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
