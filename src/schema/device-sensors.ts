import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { devices } from "./devices";

export const deviceSensors = sqliteTable("device_sensors", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  sensorType: text("sensor_type").notNull(),
  unit: text("unit").notNull(),
  minThreshold: real("min_threshold"),
  maxThreshold: real("max_threshold"),
  isAlertable: integer("is_alertable", { mode: "boolean" }).notNull().default(false),
});