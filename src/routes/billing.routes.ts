/**
 * Billing Routes — Phase 5 payment and subscription management endpoints.
 * All routes require authMiddleware + orgScopingMiddleware (same as existing routes).
 * Uses Zod validation on all inputs, Drizzle ORM for DB queries with org-scoping.
 */
import { Hono } from "hono";
import type { Env } from "../types/env";
import type { JwtPayload } from "../auth/jwt-verifier";
import { authMiddleware, orgScopingMiddleware } from "../middleware/auth.middleware";
import { checkoutRequestValidator, paymentQueryValidator } from "../validators/billing.validator";
import { createPaymentLink } from "../adapters/wompi-adapter";
import { getSubscriptionStatus } from "../services/subscription.service";
import { PLAN_FEATURES } from "../services/plan-feature.service";
import { getDrizzleDb } from "../utils/db.util";
import { payments } from "../schema/payments";
import { eq, sql } from "drizzle-orm";

export const billingRoutes = new Hono<{ Bindings: Env }>();

// All billing routes require authentication and org scoping
billingRoutes.use("*", authMiddleware);
billingRoutes.use("*", orgScopingMiddleware);

// ---------------------------------------------------------------------------
// POST /checkout — Generate Wompi payment link for plan purchase
// ---------------------------------------------------------------------------
billingRoutes.post("/checkout", async (c) => {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const organizationId = jwtPayload.org_id;
  if (!organizationId) {
    return c.json({ error: "User must belong to an organization" }, 403);
  }

  const requestBody = await c.req.json();
  const parsed = checkoutRequestValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({
      error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    }, 400);
  }

  try {
    const paymentLinkResponse = await createPaymentLink(c.env, {
      amountInCents: parsed.data.deviceCount * 850000,
      currency: "COP",
      reference: `${organizationId}:${parsed.data.planId}:${Date.now()}`,
      publicKey: c.env.WOMPI_PUBLIC_KEY,
      redirectUrl: parsed.data.returnUrl,
    });

    return c.json({
      url: paymentLinkResponse.url,
      reference: paymentLinkResponse.reference,
      expiresAt: paymentLinkResponse.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment link creation failed";
    return c.json({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /subscription — Get current subscription status for the org
// ---------------------------------------------------------------------------
billingRoutes.get("/subscription", async (c) => {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const organizationId = jwtPayload.org_id;
  if (!organizationId) {
    return c.json({ error: "User must belong to an organization" }, 403);
  }

  try {
    const db = getDrizzleDb(c.env);
    const subscription = await getSubscriptionStatus(db, organizationId);
    return c.json(subscription);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch subscription";
    return c.json({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /plans — List available plans with features and pricing
// ---------------------------------------------------------------------------
billingRoutes.get("/plans", async (c) => {
  const planPricing: Record<string, number> = {
    trial: 0,
    starter: 850000,
    professional: 1490000,
    enterprise: 2150000,
  };

  const plans = Object.entries(PLAN_FEATURES).map(([name, features]) => ({
    name,
    pricePerDeviceCents: planPricing[name] ?? 0,
    currency: "COP",
    ...features,
  }));

  return c.json({ plans });
});

// ---------------------------------------------------------------------------
// GET /payments — List payment history for the org (paginated)
// ---------------------------------------------------------------------------
billingRoutes.get("/payments", async (c) => {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const organizationId = jwtPayload.org_id;
  if (!organizationId) {
    return c.json({ error: "User must belong to an organization" }, 403);
  }

  const parsed = paymentQueryValidator.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });

  if (!parsed.success) {
    return c.json({
      error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    }, 400);
  }

  const { limit, offset } = parsed.data;
  const db = getDrizzleDb(c.env);

  try {
    const paymentRecords = await db.select()
      .from(payments)
      .where(eq(payments.organizationId, organizationId))
      .limit(limit)
      .offset(offset)
      .all();

    const countResult = await db.select({ count: sql<number>`count(*)`.as("count") })
      .from(payments)
      .where(eq(payments.organizationId, organizationId))
      .get();

    return c.json({
      payments: paymentRecords,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch payments";
    return c.json({ error: message }, 500);
  }
});