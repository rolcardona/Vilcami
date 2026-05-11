import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { devices } from "./devices";
import { deviceSensors } from "./device-sensors";

export const alertSeverityEnum = text("severity", {
  enum: ["p0", "p1", "p2", "p3"],
});

export const alertConditionOperatorEnum = text("condition_operator", {
  enum: ["gt", "lt", "gte", "lte", "eq", "between", "streak_gte", "stddev_gt", "diff_lt"],
});

export const alertRules = sqliteTable("alert_rules", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id").references(() => devices.id),
  sensorId: text("sensor_id").references(() => deviceSensors.id),
  ruleName: text("rule_name").notNull(),
  severity: alertSeverityEnum.notNull(),
  conditionOperator: alertConditionOperatorEnum.notNull(),
  thresholdValue: real("threshold_value").notNull(),
  thresholdValueMax: real("threshold_value_max"),
  deadbandValue: real("deadband_value").notNull().default(2.0),
  timeDelaySeconds: integer("time_delay_seconds").notNull().default(0),
  channels: text("channels").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  maintenanceWindowStart: integer("maintenance_window_start", { mode: "timestamp" }),
  maintenanceWindowEnd: integer("maintenance_window_end", { mode: "timestamp" }),
});