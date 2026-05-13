import { Hono } from "hono";
import type { Env } from "../types/env";
import { authMiddleware, orgScopingMiddleware } from "../middleware/auth.middleware";
import { requireSubscription, requireDeviceQuota } from "../middleware/subscription.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import type { JwtPayload } from "../auth/jwt-verifier";
import * as deviceManagementService from "../services/device-management.service";

export const deviceRoutes = new Hono<{ Bindings: Env }>();

// All routes in this router require authentication and org scoping
deviceRoutes.use("*", authMiddleware);
deviceRoutes.use("*", orgScopingMiddleware);

// -------------------------------------------------------------------------
// GET / — list all devices for the authenticated organization
// -------------------------------------------------------------------------
deviceRoutes.get("/", requireSubscription(), async (c) => {
  const organizationFilter = c.get("organizationFilter");
  const result = await deviceManagementService.listDevices(c.env, organizationFilter);
  return c.json(result);
});

// -------------------------------------------------------------------------
// GET /:deviceId — get a single device by ID
// -------------------------------------------------------------------------
deviceRoutes.get("/:deviceId", async (c) => {
  const deviceId = c.req.param("deviceId");
  const organizationFilter = c.get("organizationFilter");
  const result = await deviceManagementService.getDevice(c.env, deviceId, organizationFilter);

  if (!result.device) {
    c.status(404);
    return c.json({ error: "Device not found" });
  }
  return c.json(result);
});

// -------------------------------------------------------------------------
// POST / — create a new device
// -------------------------------------------------------------------------
deviceRoutes.post("/", requireSubscription(), requireDeviceQuota(), requirePermission("devices:create"), async (c) => {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  if (!jwtPayload.org_id) {
    return c.json({ error: "User must belong to an organization to create devices" }, 403);
  }
  const requestBody = await c.req.json();
  const result = await deviceManagementService.createDevice(
    c.env,
    requestBody,
    jwtPayload.org_id,
  );

  if (!result.success) {
    c.status(400);
    return c.json({ error: result.error });
  }
  c.status(201);
  return c.json({ device: result.device });
});

// -------------------------------------------------------------------------
// PATCH /:deviceId — update an existing device
// -------------------------------------------------------------------------
deviceRoutes.patch("/:deviceId", requirePermission("devices:update"), async (c) => {
  const deviceId = c.req.param("deviceId")!;
  const organizationFilter = c.get("organizationFilter");
  const requestBody = await c.req.json();
  const result = await deviceManagementService.updateDevice(
    c.env,
    deviceId,
    requestBody,
    organizationFilter,
  );

  if (!result.success) {
    const statusCode = result.error === "Device not found or access denied" ? 404 : 400;
    c.status(statusCode);
    return c.json({ error: result.error });
  }
  return c.json({ device: result.device });
});

// -------------------------------------------------------------------------
// DELETE /:deviceId — delete a device
// -------------------------------------------------------------------------
deviceRoutes.delete("/:deviceId", requirePermission("devices:delete"), async (c) => {
  const deviceId = c.req.param("deviceId")!;
  const organizationFilter = c.get("organizationFilter");
  const result = await deviceManagementService.deleteDevice(
    c.env,
    deviceId,
    organizationFilter,
  );

  if (!result.success) {
    c.status(404);
    return c.json({ error: result.error });
  }
  c.status(204);
  return c.body(null);
});
