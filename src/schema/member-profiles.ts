import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const memberProfiles = sqliteTable("member_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  memberId: text("member_id").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  whatsappNumber: text("whatsapp_number"),
  smsNumber: text("sms_number"),
  preferredChannel: text("preferred_channel").notNull().default("email"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});