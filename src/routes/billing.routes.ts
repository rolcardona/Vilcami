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
import { NotFoundError } from "../errors/not-found.error";
import { PLAN_FEATURES } from "../services/plan-feature.service";
import { getDrizzleDb } from "../utils/db.util";
import { payments } from "../schema/payments";
import { subscriptionPlans } from "../schema/subscription-plans";
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
    // Validate planId against DB and retrieve server-side price
    const db = getDrizzleDb(c.env);
    const planRow = await db.select({
      id: subscriptionPlans.id,
      pricePerDeviceCents: subscriptionPlans.pricePerDeviceCents,
    }).from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, parsed.data.planId))
      .limit(1).get();

    if (!planRow) {
      return c.json({ error: "Invalid planId: plan not found" }, 400);
    }

    // Server-side amount calculation (never trust client price)
    const amountInCents = planRow.pricePerDeviceCents * parsed.data.deviceCount;
    const reference = `${organizationId}:${parsed.data.planId}:${Date.now()}`;

    // Store checkout amount in KV for webhook verification (1-hour TTL)
    await c.env.SECRETS_VAULT.put(
      `checkout:${reference}`,
      JSON.stringify({ amountInCents, planId: parsed.data.planId, orgId: organizationId }),
      { expirationTtl: 3600 },
    );

    // Resolve per-organization Wompi public key from KV Vault, fallback to env var
    const orgWompiPublicKey = await c.env.SECRETS_VAULT.get(
      `${organizationId}:secret:wompi_public_key`,
    );
    const resolvedPublicKey = orgWompiPublicKey ?? c.env.WOMPI_PUBLIC_KEY;

    const paymentLinkResponse = await createPaymentLink(c.env, {
      amountInCents,
      currency: "COP",
      reference,
      publicKey: resolvedPublicKey,
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
    if (error instanceof NotFoundError) {
      return c.json({ error: "No subscription found for organization" }, 404);
    }
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