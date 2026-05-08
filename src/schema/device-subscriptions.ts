import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { devices } from "./devices";
import { subscriptionPlans } from "./subscription-plans";

export const deviceSubscriptionStatusEnum = text("status", {
  enum: ["trial", "active", "past_due", "suspended", "cancelled"],
});

export const deviceSubscriptions = sqliteTable("device_subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  planId: text("plan_id")
    .notNull()
    .references(() => subscriptionPlans.id),
  status: deviceSubscriptionStatusEnum.notNull(),
  trialStartsAt: integer("trial_starts_at", { mode: "timestamp" }),
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
  currentPeriodStart: integer("current_period_start", { mode: "timestamp" }),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  addOns: text("add_ons"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});