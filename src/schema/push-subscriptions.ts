import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizationMembers } from "./organization-members";

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  memberId: text("member_id")
    .notNull()
    .references(() => organizationMembers.id),
  endpoint: text("endpoint").notNull(),
  p256dhKey: text("p256dh_key").notNull(),
  authKey: text("auth_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});