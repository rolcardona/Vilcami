import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { subscriptionPlans } from "./subscription-plans";

export const paymentStatusEnum = text("status", {
  enum: ["pending", "completed", "failed", "refunded"],
});

export const paymentMethodEnum = text("payment_method", {
  enum: ["card", "pse", "nequi"],
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  wompiTransactionId: text("wompi_transaction_id").notNull(),
  amountInCents: integer("amount_in_cents").notNull(),
  currency: text("currency").notNull().default("COP"),
  status: paymentStatusEnum.notNull(),
  paymentMethod: paymentMethodEnum,
  planId: text("plan_id").references(() => subscriptionPlans.id),
  deviceCount: integer("device_count").notNull().default(1),
  billingPeriodStart: integer("billing_period_start").notNull(),
  billingPeriodEnd: integer("billing_period_end").notNull(),
  wompiReference: text("wompi_reference"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => ({
  wompiTransactionIdIdx: uniqueIndex("idx_payments_wompi_transaction_id").on(table.wompiTransactionId),
}));