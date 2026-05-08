import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { deviceSubscriptions } from "./device-subscriptions";

export const billingEventTypeEnum = text("event_type", {
  enum: ["api_call_tuya", "api_call_modbus"],
});

export const billingEvents = sqliteTable("billing_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceSubscriptionId: text("device_subscription_id")
    .notNull()
    .references(() => deviceSubscriptions.id),
  eventTimestamp: integer("event_timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  eventType: billingEventTypeEnum.notNull(),
  deviceExternalId: text("device_external_id").notNull(),
  sensorCount: integer("sensor_count").notNull().default(1),
});