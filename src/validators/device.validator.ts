import { z } from "zod";

export const deviceValidator = z.object({
  name: z.string().min(1).max(200),
  deviceExternalId: z.string().min(1),
  protocolType: z.enum(["tuya", "modbus"]),
  location: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/**
 * Validator for device creation (POST /api/devices).
 * Extends deviceValidator with organizationId and uses .strict() to reject unknown fields.
 */
export const deviceCreateValidator = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(200),
  deviceExternalId: z.string().min(1),
  protocolType: z.enum(["tuya", "modbus"]),
  location: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).strict();

/**
 * Validator for device updates (PATCH /api/devices/:id).
 * All fields optional — only provided fields are updated.
 * Uses .strict() to reject unknown fields.
 */
export const deviceUpdateValidator = z.object({
  name: z.string().min(1).max(200).optional(),
  deviceExternalId: z.string().min(1).optional(),
  protocolType: z.enum(["tuya", "modbus"]).optional(),
  location: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).strict();