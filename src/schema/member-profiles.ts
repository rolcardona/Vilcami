import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizationMembers } from "./organization-members";

export const preferredChannelEnum = text("preferred_channel", {
  enum: ["whatsapp", "sms", "email", "push"],
});

export const memberProfiles = sqliteTable("member_profiles", {
  id: text("id").primaryKey(),
  memberId: text("member_id")
    .notNull()
    .references(() => organizationMembers.id),
  organizationId: text("organization_id").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  whatsappNumber: text("whatsapp_number"),
  smsNumber: text("sms_number"),
  preferredChannel: preferredChannelEnum.default("email"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});