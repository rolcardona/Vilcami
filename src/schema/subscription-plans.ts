import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const subscriptionPlanNameEnum = text("name", {
  enum: ["Starter", "Professional", "Enterprise"],
});

export const subscriptionPlans = sqliteTable("subscription_plans", {
  id: text("id").primaryKey(),
  name: subscriptionPlanNameEnum.notNull(),
  currencyCode: text("currency_code").notNull(),
  pricePerDeviceCents: integer("price_per_device_cents").notNull(),
  eventsIncluded: integer("events_included").notNull(),
  overagePricePerHundredCents: integer("overage_price_per_hundred_cents").notNull(),
  features: text("features").notNull(),
  trialDays: integer("trial_days").notNull().default(30),
  maxTrialDevices: integer("max_trial_devices").notNull().default(3),
  isTrialPlan: integer("is_trial_plan", { mode: "boolean" }).notNull().default(false),
});