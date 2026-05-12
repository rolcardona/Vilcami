import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const wompiEvents = sqliteTable("wompi_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  wompiEventId: text("wompi_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  processedAt: integer("processed_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => ({
  wompiEventIdIdx: uniqueIndex("idx_wompi_events_event_id").on(table.wompiEventId),
}));