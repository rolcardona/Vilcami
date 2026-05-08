import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { alertLifecycle } from "./alert-lifecycle";
import { organizationMembers } from "./organization-members";

export const alertEscalations = sqliteTable("alert_escalations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  alertLifecycleId: text("alert_lifecycle_id")
    .notNull()
    .references(() => alertLifecycle.id),
  escalatedToMemberId: text("escalated_to_member_id")
    .notNull()
    .references(() => organizationMembers.id),
  escalationLevel: integer("escalation_level").notNull(),
  channel: text("channel").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
});