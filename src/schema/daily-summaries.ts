import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const dailySummaries = sqliteTable("daily_summaries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id").notNull(),
  sensorId: text("sensor_id").notNull(),
  dateBucket: text("date_bucket").notNull(),
  avgValue: real("avg_value").notNull(),
  minValue: real("min_value").notNull(),
  maxValue: real("max_value").notNull(),
  stdDev: real("std_dev"),
  sampleCount: integer("sample_count").notNull(),
  alertCount: integer("alert_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});