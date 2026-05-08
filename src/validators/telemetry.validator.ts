import { z } from "zod";

export const telemetryValidator = z.object({
  organizationId: z.string().min(1),
  deviceId: z.string().min(1),
  sensorId: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  timestamp: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional(),
});