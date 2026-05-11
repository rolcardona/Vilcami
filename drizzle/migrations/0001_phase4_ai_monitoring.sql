-- Phase 4 AI: alerts, push_subscriptions, member_profiles, alert_lifecycle.alert_id, alert_rules condition_operator extension

-- New table: alerts
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sensor_id` text,
	`severity` text NOT NULL,
	`rule_type` text NOT NULL,
	`alert_rule_id` text,
	`alert_lifecycle_id` text,
	`current_value` text NOT NULL,
	`threshold_value` text NOT NULL,
	`message` text NOT NULL,
	`ai_context` text,
	`channels` text NOT NULL,
	`acknowledged_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sensor_id`) REFERENCES `device_sensors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`alert_rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_organization_id` ON `alerts` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_alerts_device_id` ON `alerts` (`device_id`);
--> statement-breakpoint
CREATE INDEX `idx_alerts_severity` ON `alerts` (`organization_id`,`severity`);
--> statement-breakpoint
CREATE INDEX `idx_alerts_created_at` ON `alerts` (`organization_id`,`created_at`);
--> statement-breakpoint

-- New table: push_subscriptions
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`member_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh_key` text NOT NULL,
	`auth_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `organization_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_org` ON `push_subscriptions` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_member` ON `push_subscriptions` (`member_id`);
--> statement-breakpoint

-- New table: member_profiles
CREATE TABLE `member_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text,
	`whatsapp_number` text,
	`sms_number` text,
	`preferred_channel` text DEFAULT 'email',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `organization_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_member_profiles_org` ON `member_profiles` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `idx_member_profiles_member` ON `member_profiles` (`member_id`);
--> statement-breakpoint

-- Extend alert_lifecycle with alert_id FK (bidirectional link with alerts)
ALTER TABLE `alert_lifecycle` ADD COLUMN `alert_id` text REFERENCES `alerts`(`id`);