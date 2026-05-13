/**
 * Subscription Middleware — gates API access based on subscription status,
 * feature availability, and device quota limits.
 *
 * MUST run after authMiddleware (reads organizationId from context).
 * Follows the same Hono middleware pattern as auth.middleware.ts.
 */
import type { Context, Next } from "hono";
import type { Env } from "../types/env";
import type { FeatureName, PlanName } from "../types/billing.types";
import { getSubscriptionStatus } from "../services/subscription.service";
import { hasFeature, getDeviceLimit, PLAN_FEATURES } from "../services/plan-feature.service";
import { getDrizzleDb } from "../utils/db.util";

/** Subscription statuses that allow API access */
const ALLOWED_STATUSES = new Set(["trial", "active", "past_due"]);

// ---------------------------------------------------------------------------
// requireSubscription — verifies org has an active/trial/past_due subscription
// ---------------------------------------------------------------------------
export function requireSubscription() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const organizationId = c.get("organizationId") as string;
    if (!organizationId) {
      return c.json({ error: "Missing organizationId in context" }, 401);
    }

    const db = getDrizzleDb(c.env);

    const subscription = await getSubscriptionStatus(db, organizationId);
    if (!subscription) {
      return c.json({
        error: "no_subscription",
        upgradeInfo: { currentStatus: "none", message: "No subscription found for your organization." },
      }, 402);
    }

    const status = subscription.status;

    if (status === "suspended") {
      return c.json({
        error: "subscription_suspended",
        upgradeInfo: {
          plan: subscription.planName,
          currentStatus: status,
          message: "Your subscription is suspended. Update payment to restore access.",
        },
      }, 402);
    }

    if (status === "cancelled") {
      return c.json({
        error: "subscription_cancelled",
        upgradeInfo: {
          plan: subscription.planName,
          currentStatus: status,
          message: "Your subscription has been cancelled. Subscribe to a plan to continue.",
        },
      }, 401);
    }

    if (ALLOWED_STATUSES.has(status)) {
      if (status === "past_due") {
        c.header("X-Subscription-Past-Due", "true");
      }
      await next();
      return;
    }

    // Unknown status — treat as no subscription
    return c.json({
      error: "no_subscription",
      upgradeInfo: { currentStatus: status, message: "No valid subscription found." },
    }, 402);
  };
}

// ---------------------------------------------------------------------------
// requireFeature — middleware factory that verifies org plan includes feature
// ---------------------------------------------------------------------------
export function requireFeature(featureName: FeatureName) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const organizationId = c.get("organizationId") as string;
    if (!organizationId) {
      return c.json({ error: "Missing organizationId in context" }, 401);
    }

    const db = getDrizzleDb(c.env);

    const subscription = await getSubscriptionStatus(db, organizationId);
    if (!subscription) {
      return c.json({
        error: "feature_not_included",
        requiredPlan: getMinimumPlanForFeature(featureName),
        currentPlan: "none",
        upgradeUrl: "/api/billing/plans",
      }, 403);
    }

    const planName = subscription.planName as PlanName;

    if (hasFeature(planName, featureName)) {
      await next();
      return;
    }

    return c.json({
      error: "feature_not_included",
      requiredPlan: getMinimumPlanForFeature(featureName),
      currentPlan: planName,
      upgradeUrl: "/api/billing/plans",
    }, 403);
  };
}

// ---------------------------------------------------------------------------
// requireDeviceQuota — verifies org has not exceeded device limit for plan
// ---------------------------------------------------------------------------
export function requireDeviceQuota() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const organizationId = c.get("organizationId") as string;
    if (!organizationId) {
      return c.json({ error: "Missing organizationId in context" }, 401);
    }

    const db = getDrizzleDb(c.env);

    const subscription = await getSubscriptionStatus(db, organizationId);
    if (!subscription) {
      return c.json({
        error: "device_quota_exceeded",
        currentCount: 0,
        maxAllowed: 0,
        upgradeUrl: "/api/billing/plans",
      }, 403);
    }

    const planName = subscription.planName as PlanName;
    const maxAllowed = getDeviceLimit(planName);

    // Enterprise has Infinity limit — always passes
    if (maxAllowed === Infinity) {
      await next();
      return;
    }

    if (subscription.deviceCount >= maxAllowed) {
      return c.json({
        error: "device_quota_exceeded",
        currentCount: subscription.deviceCount,
        maxAllowed,
        upgradeUrl: "/api/billing/plans",
      }, 403);
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Helper: minimum plan tier that includes a given feature
// Derived dynamically from PLAN_FEATURES to avoid a second source of truth.
// Plans are checked in tier order (trial → starter → professional → enterprise),
// returning the first plan whose features array includes the requested feature.
// ---------------------------------------------------------------------------
const PLAN_TIER_ORDER: PlanName[] = ["trial", "starter", "professional", "enterprise"];

function getMinimumPlanForFeature(featureName: FeatureName): PlanName {
  for (const plan of PLAN_TIER_ORDER) {
    if (PLAN_FEATURES[plan].features.includes(featureName)) return plan;
  }
  return "enterprise";
}

// Extend Hono's context variable map for subscription middleware keys
declare module "hono" {
  interface ContextVariableMap {
    organizationId: string;
  }
}