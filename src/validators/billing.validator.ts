import { z } from "zod";

export const billingEventValidator = z.object({
  organizationId: z.string().min(1),
  deviceSubscriptionId: z.string().min(1),
  eventType: z.enum(["api_call_tuya", "api_call_modbus"]),
  deviceExternalId: z.string().min(1),
  sensorCount: z.number().int().min(1).default(1),
});