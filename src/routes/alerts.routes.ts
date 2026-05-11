import { Hono } from "hono";
import type { Env } from "../types/env";
import { authMiddleware, orgScopingMiddleware } from "../middleware/auth.middleware";
import type { JwtPayload } from "../auth/jwt-verifier";
import {
  listAlertsValidator,
  acknowledgeAlertValidator,
  resolveAlertValidator,
  shelveAlertValidator,
  pushSubscriptionValidator,
} from "../validators/alert.validator";
import * as alertService from "../services/alert-management.service";

export const alertRoutes = new Hono<{ Bindings: Env }>();

// All alert routes require authentication and org scoping
alertRoutes.use("*", authMiddleware);
alertRoutes.use("*", orgScopingMiddleware);

// ---------------------------------------------------------------------------
// GET / — List alerts (paginated, filterable by severity/status/device)
// ---------------------------------------------------------------------------
alertRoutes.get("/", async (c) => {
  const organizationFilter = c.get("organizationFilter") as string | null;

  const rawPage = parseInt(c.req.query("page") ?? "1", 10);
  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const severity = c.req.query("severity") ?? undefined;
  const status = c.req.query("status") ?? undefined;
  const deviceId = c.req.query("deviceId") ?? undefined;

  const parsed = listAlertsValidator.safeParse({
    page: rawPage, limit: rawLimit, severity, status, deviceId,
  });

  if (!parsed.success) {
    return c.json({ error: `Invalid query parameters: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, 400);
  }

  const result = await alertService.listAlerts(c.env, organizationFilter, parsed.data);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /active/count — Active alert count by severity
// NOTE: Must be registered before /:alertId to avoid "active" being captured as alertId
// ---------------------------------------------------------------------------
alertRoutes.get("/active/count", async (c) => {
  const organizationFilter = c.get("organizationFilter") as string | null;
  const result = await alertService.getActiveAlertCountsBySeverity(c.env, organizationFilter);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /:alertId — Get alert details with AI context parsed
// ---------------------------------------------------------------------------
alertRoutes.get("/:alertId", async (c) => {
  const alertId = c.req.param("alertId");
  const organizationFilter = c.get("organizationFilter") as string | null;
  const result = await alertService.getAlertById(c.env, alertId, organizationFilter);

  if (!result.alert) {
    return c.json({ error: "Alert not found" }, 404);
  }

  // Parse aiContext JSON string into an object for easier client consumption
  const alertData = { ...result.alert };
  if (typeof alertData.aiContext === "string") {
    try {
      alertData.aiContext = JSON.parse(alertData.aiContext as string);
    } catch {
      // Leave aiContext as-is if not valid JSON
    }
  }

  return c.json({ alert: alertData });
});

// ---------------------------------------------------------------------------
// PATCH /:alertId/acknowledge — Acknowledge alert
// ---------------------------------------------------------------------------
alertRoutes.patch("/:alertId/acknowledge", async (c) => {
  const alertId = c.req.param("alertId");
  const organizationFilter = c.get("organizationFilter") as string | null;
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const requestBody = await c.req.json();
  const parsed = acknowledgeAlertValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({ error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, 400);
  }

  const result = await alertService.acknowledgeAlert(
    c.env, alertId, organizationFilter, jwtPayload.sub, parsed.data.acknowledgmentNotes,
  );

  if (!result.success) {
    const statusCode = result.error === "Alert not found" ? 404 : 400;
    return c.json({ error: result.error }, statusCode);
  }

  return c.json({ alert: result.alert });
});

// ---------------------------------------------------------------------------
// PATCH /:alertId/resolve — Resolve alert
// ---------------------------------------------------------------------------
alertRoutes.patch("/:alertId/resolve", async (c) => {
  const alertId = c.req.param("alertId");
  const organizationFilter = c.get("organizationFilter") as string | null;
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const requestBody = await c.req.json();
  const parsed = resolveAlertValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({ error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, 400);
  }

  const result = await alertService.resolveAlert(
    c.env, alertId, organizationFilter, jwtPayload.sub, parsed.data.resolutionNotes,
  );

  if (!result.success) {
    const statusCode = result.error === "Alert not found" ? 404 : 400;
    return c.json({ error: result.error }, statusCode);
  }

  return c.json({ alert: result.alert });
});

// ---------------------------------------------------------------------------
// POST /:alertId/shelve — Temporarily shelve alert
// ---------------------------------------------------------------------------
alertRoutes.post("/:alertId/shelve", async (c) => {
  const alertId = c.req.param("alertId");
  const organizationFilter = c.get("organizationFilter") as string | null;
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const requestBody = await c.req.json();
  const parsed = shelveAlertValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({ error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, 400);
  }

  const result = await alertService.shelveAlert(
    c.env, alertId, organizationFilter, jwtPayload.sub,
    parsed.data.shelvedUntilTimestamp, parsed.data.shelvingReason,
  );

  if (!result.success) {
    const statusCode = result.error === "Alert not found" ? 404 : 400;
    return c.json({ error: result.error }, statusCode);
  }

  return c.json({ alert: result.alert });
});

// ---------------------------------------------------------------------------
// Push Subscription Routes (mounted at /api/push-subscriptions)
// ---------------------------------------------------------------------------
export const pushSubscriptionRoutes = new Hono<{ Bindings: Env }>();

pushSubscriptionRoutes.use("*", authMiddleware);
pushSubscriptionRoutes.use("*", orgScopingMiddleware);

// POST / — Register browser push subscription
pushSubscriptionRoutes.post("/", async (c) => {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  if (!jwtPayload.org_id) {
    return c.json({ error: "User must belong to an organization to register push subscriptions" }, 403);
  }

  const requestBody = await c.req.json();
  const parsed = pushSubscriptionValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({ error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }, 400);
  }

  const result = await alertService.createPushSubscription(
    c.env, jwtPayload.org_id, jwtPayload.sub, parsed.data,
  );

  c.status(201);
  return c.json({ subscription: result.subscription });
});