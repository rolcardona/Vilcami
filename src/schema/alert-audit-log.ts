import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { alertLifecycle } from "./alert-lifecycle";
import { organizationMembers } from "./organization-members";

export const alertAuditActionEnum = text("action", {
  enum: ["triggered", "acknowledged", "escalated", "shelved", "suppressed", "returned_to_normal"],
});

export const alertAuditLog = sqliteTable("alert_audit_log", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  alertLifecycleId: text("alert_lifecycle_id")
    .notNull()
    .references(() => alertLifecycle.id),
  action: alertAuditActionEnum.notNull(),
  performedBy: text("performed_by").references(() => organizationMembers.id),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  details: text("details"),
});