import { z } from "zod";

export const alertRuleValidator = z.object({
  organizationId: z.string().min(1),
  deviceId: z.string().optional(),
  sensorId: z.string().optional(),
  ruleName: z.string().min(1).max(200),
  severity: z.enum(["p0", "p1", "p2", "p3"]),
  conditionOperator: z.enum(["gt", "lt", "gte", "lte", "eq", "between"]),
  thresholdValue: z.number(),
  thresholdValueMax: z.number().optional(),
  deadbandValue: z.number().default(2.0),
  timeDelaySeconds: z.number().int().min(0).default(0),
  channels: z.array(z.enum(["whatsapp", "push", "sms"])).min(1),
  enabled: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.conditionOperator === "between") {
      return data.thresholdValueMax !== undefined && data.thresholdValueMax > data.thresholdValue;
    }
    return true;
  },
  { message: "thresholdValueMax is required and must be greater than thresholdValue when operator is 'between'", path: ["thresholdValueMax"] }
);