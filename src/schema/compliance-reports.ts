import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { complianceTemplates } from "./compliance-templates";
import { organizations } from "./organizations";

export const complianceReportTypeEnum = text("report_type", {
  enum: ["haccp", "invima", "en12830", "cfia"],
});

export const complianceReportStatusEnum = text("status", {
  enum: ["generating", "ready", "sent", "failed"],
});

export const complianceReports = sqliteTable("compliance_reports", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  templateId: text("template_id")
    .notNull()
    .references(() => complianceTemplates.id),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
  reportType: complianceReportTypeEnum.notNull(),
  status: complianceReportStatusEnum.notNull(),
  pdfUrl: text("pdf_url"),
  data: text("data"),
});