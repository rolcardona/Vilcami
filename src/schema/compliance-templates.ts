import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizations } from "./organizations";

export const complianceRegulationEnum = text("regulation", {
  enum: ["HACCP", "INVIMA_DEC1500", "EN12830", "CFIA_PREVENTIVE_CONTROLS"],
});

export const complianceReportScheduleEnum = text("report_schedule", {
  enum: ["daily", "weekly", "monthly"],
});

export const complianceTemplates = sqliteTable("compliance_templates", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  regulation: complianceRegulationEnum.notNull(),
  countryCode: text("country_code").notNull(),
  thresholds: text("thresholds").notNull(),
  reportSchedule: complianceReportScheduleEnum.notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});