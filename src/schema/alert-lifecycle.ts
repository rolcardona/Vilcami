import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { alertRules } from "./alert-rules";
import { alerts } from "./alerts";
import { organizationMembers } from "./organization-members";
import { alerts } from "./alerts";

export const alertLifecycleStatusEnum = text("status", {
  enum: ["active", "acknowledged", "returned_to_normal", "shelved", "suppressed", "out_of_service"],
});

export const alertLifecycle = sqliteTable("alert_lifecycle", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  alertId: text("alert_id").references(() => alerts.id),
  alertRuleId: text("alert_rule_id")
    .notNull()
    .references(() => alertRules.id),
  alertId: text("alert_id").references(() => alerts.id),
  status: alertLifecycleStatusEnum.notNull(),
  triggeredAt: integer("triggered_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
  acknowledgedBy: text("acknowledged_by").references(() => organizationMembers.id),
  returnedToNormalAt: integer("returned_to_normal_at", { mode: "timestamp" }),
  shelvedUntil: integer("shelved_until", { mode: "timestamp" }),
  suppressionReason: text("suppression_reason"),
  outOfServiceApprovedBy: text("out_of_service_approved_by"),
});