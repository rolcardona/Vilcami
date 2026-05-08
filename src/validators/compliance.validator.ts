import { z } from "zod";

export const complianceTemplateValidator = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200),
  regulation: z.enum(["HACCP", "INVIMA_DEC1500", "EN12830", "CFIA_PREVENTIVE_CONTROLS"]),
  countryCode: z.string().length(2),
  thresholds: z.record(z.unknown()),
  reportSchedule: z.enum(["daily", "weekly", "monthly"]),
  enabled: z.boolean().default(true),
});