import { z } from "zod";

export const updatePermissionsValidator = z.object({
  permissions: z.array(z.enum([
    "devices:create",
    "devices:update",
    "devices:delete",
    "telemetry:ingest",
    "alerts:acknowledge",
    "alerts:resolve",
    "alerts:shelve",
    "billing:manage",
  ])).min(0).max(8),
});