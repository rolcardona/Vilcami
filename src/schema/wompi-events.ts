import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

/**
 * ORG-SCOPING GUARD RAIL (Finding #20):
 * ALL future read queries against `wompiEvents` MUST include
 * `WHERE organizationId = ?` scoped from JWT context.
 * This table contains per-organization payment data and must NEVER
 * be queried without an org-scoping filter. The `organizationId` column
 * is the mandatory scoping key for multi-tenant isolation.
 */
export const wompiEvents = sqliteTable("wompi_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  wompiEventId: text("wompi_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  processedAt: integer("processed_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => ({
  wompiEventIdIdx: uniqueIndex("idx_wompi_events_event_id").on(table.wompiEventId),
}));