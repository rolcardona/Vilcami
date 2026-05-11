import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { devices } from "./devices";
import { deviceSensors } from "./device-sensors";
import { alertRules } from "./alert-rules";

export const alertRuleTypeEnum = text("rule_type", {
  enum: ["critical_threshold", "y2_differential", "consecutive_streak", "std_deviation"],
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id),
  sensorId: text("sensor_id").references(() => deviceSensors.id),
  severity: text("severity", { enum: ["p0", "p1", "p2", "p3"] }).notNull(),
  ruleType: alertRuleTypeEnum.notNull(),
  alertRuleId: text("alert_rule_id").references(() => alertRules.id),
  alertLifecycleId: text("alert_lifecycle_id"),
  currentValue: text("current_value").notNull(),
  thresholdValue: text("threshold_value").notNull(),
  message: text("message").notNull(),
  aiContext: text("ai_context"),
  channels: text("channels").notNull(),
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});