import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { organizations } from "./organizations";

export const deviceProtocolTypeEnum = text("protocol_type", {
  enum: ["tuya", "modbus"],
});

export const deviceStatusEnum = text("status", {
  enum: ["online", "offline", "maintenance"],
});

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  deviceExternalId: text("device_external_id").notNull(),
  protocolType: deviceProtocolTypeEnum.notNull(),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  status: deviceStatusEnum.notNull().default("offline"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});