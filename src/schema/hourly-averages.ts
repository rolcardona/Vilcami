import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const hourlyAverages = sqliteTable("hourly_averages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id").notNull(),
  sensorId: text("sensor_id").notNull(),
  hourBucket: integer("hour_bucket", { mode: "timestamp" }).notNull(),
  avgValue: real("avg_value").notNull(),
  minValue: real("min_value").notNull(),
  maxValue: real("max_value").notNull(),
  sampleCount: integer("sample_count").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});