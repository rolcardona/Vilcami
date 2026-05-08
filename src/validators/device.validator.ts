import { z } from "zod";

export const deviceValidator = z.object({
  name: z.string().min(1).max(200),
  deviceExternalId: z.string().min(1),
  protocolType: z.enum(["tuya", "modbus"]),
  location: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});