import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { devices } from "./devices";

export const alertSeverityLevelEnum = text("severity", {
  enum: ["critical", "high", "medium", "low"],
});

export const alertRuleTypeEnum = text("rule_type", {
  enum: ["critical_threshold", "y2_differential", "consecutive_streak", "standard_deviation"],
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  sensorType: text("sensor_type").notNull(),
  severity: alertSeverityLevelEnum.notNull(),
  ruleType: alertRuleTypeEnum.notNull(),
  currentValue: text("current_value").notNull(),
  thresholdValue: text("threshold_value").notNull(),
  aiMessage: text("ai_message").notNull(),
  aiContext: text("ai_context").notNull(),
  channels: text("channels").notNull(),
  acknowledgedAt: integer("acknowledged_at"),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});