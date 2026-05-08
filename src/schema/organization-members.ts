import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizations } from "./organizations";

export const organizationMemberRoleEnum = text("role", {
  enum: ["admin_vilcami", "admin", "user"],
});

export const organizationMemberStatusEnum = text("status", {
  enum: ["active", "suspended"],
});

export const organizationMembers = sqliteTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  supabaseUserId: text("supabase_user_id").notNull(),
  role: organizationMemberRoleEnum.notNull(),
  status: organizationMemberStatusEnum.notNull().default("active"),
  invitedAt: integer("invited_at", { mode: "timestamp" }),
  joinedAt: integer("joined_at", { mode: "timestamp" }),
  suspendedAt: integer("suspended_at", { mode: "timestamp" }),
  suspendedReason: text("suspended_reason"),
});