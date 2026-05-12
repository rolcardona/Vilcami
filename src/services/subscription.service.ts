/**
 * Subscription Service — lifecycle management for VILCAMI billing.
 * Handles: status queries, activations, state transitions, time-based
 * lifecycle enforcement (trial expiry, grace periods, cancellations).
 * All DB queries are org-scoped via organizationId (CLAUDE.md hard rule).
 */
import { eq, sql } from "drizzle-orm";
import { deviceSubscriptions, subscriptionPlans, devices } from "../schema/index";
import type { SubscriptionStatus, SubscriptionResponse, PlanName } from "../types/billing.types";
import { getDeviceLimit } from "./plan-feature.service";

type DrizzleDb = ReturnType<typeof import("../utils/db.util").getDrizzleDb>;

const VALID_TRANSITIONS: Record<SubscriptionStatus, Set<SubscriptionStatus>> = {
  trial: new Set(["active", "suspended"]),
  active: new Set(["past_due"]),
  past_due: new Set(["active", "suspended"]),
  suspended: new Set(["active", "cancelled"]),
  cancelled: new Set(["active"]),
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function mapPlanName(dbName: string | null): PlanName {
  if (!dbName) return "trial";
  const n = dbName.toLowerCase();
  if (n === "starter") return "starter";
  if (n === "professional") return "professional";
  if (n === "enterprise") return "enterprise";
  return "trial";
}

function toDateMs(v: Date | number | null): number {
  if (!v) return 0;
  return v instanceof Date ? v.getTime() : Number(v);
}

/** Find the org's current subscription row (org-scoped). */
async function findOrgSubscription(db: DrizzleDb, organizationId: string) {
  return db.select().from(deviceSubscriptions)
    .where(eq(deviceSubscriptions.organizationId, organizationId))
    .limit(1).get();
}

/** Update subscription status (org-scoped). */
async function updateSubStatus(db: DrizzleDb, organizationId: string, status: SubscriptionStatus, extra?: Record<string, unknown>) {
  await db.update(deviceSubscriptions).set({ status, ...extra })
    .where(eq(deviceSubscriptions.organizationId, organizationId)).run();
}

// ---------------------------------------------------------------------------
// getSubscriptionStatus — returns current org subscription details, or null
// ---------------------------------------------------------------------------
export async function getSubscriptionStatus(
  db: DrizzleDb, organizationId: string,
): Promise<SubscriptionResponse | null> {
  const sub = await findOrgSubscription(db, organizationId);
  if (!sub) return null;

  const planRow = await db.select({ name: subscriptionPlans.name })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, sub.planId)).get();

  const planName: PlanName = sub.status === "trial" ? "trial" : mapPlanName(planRow?.name ?? null);
  const deviceCountRow = await db.select({ count: sql<number>`count(*)`.as("count") })
    .from(devices).where(eq(devices.organizationId, organizationId)).all();

  // currentPeriodEnd: for trial, fall back to trialEndsAt; for paid, use currentPeriodEnd only
  const periodEnd = sub.status === "trial"
    ? (toDateMs(sub.currentPeriodEnd) || toDateMs(sub.trialEndsAt))
    : toDateMs(sub.currentPeriodEnd);

  return {
    organizationId,
    planName,
    status: sub.status as SubscriptionStatus,
    currentPeriodStart: toDateMs(sub.currentPeriodStart) || toDateMs(sub.trialStartsAt),
    currentPeriodEnd: periodEnd,
    deviceCount: deviceCountRow[0]?.count ?? 0,
    maxDevices: getDeviceLimit(planName),
  };
}

// ---------------------------------------------------------------------------
// activateSubscription — upgrade trial/past_due to active on payment approval
// ---------------------------------------------------------------------------
export async function activateSubscription(
  db: DrizzleDb, organizationId: string, planId: string, _paymentId: string,
): Promise<{ status: SubscriptionStatus }> {
  const existing = await findOrgSubscription(db, organizationId);
  const now = new Date();
  const periodEnd = new Date(now.getTime() + THIRTY_DAYS_MS);

  if (existing) {
    const currentStatus = existing.status as SubscriptionStatus;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed?.has("active")) {
      throw new Error(`Invalid subscription transition: ${currentStatus} → active`);
    }
    await updateSubStatus(db, organizationId, "active", {
      planId, currentPeriodStart: now, currentPeriodEnd: periodEnd,
    });
  } else {
    await db.insert(deviceSubscriptions).values({
      id: crypto.randomUUID(), organizationId,
      deviceId: crypto.randomUUID(), planId, status: "active",
      currentPeriodStart: now, currentPeriodEnd: periodEnd,
    }).run();
  }
  return { status: "active" };
}

// ---------------------------------------------------------------------------
// transitionSubscriptionStatus — validates and applies state transitions
// ---------------------------------------------------------------------------
export async function transitionSubscriptionStatus(
  db: DrizzleDb, organizationId: string, newStatus: SubscriptionStatus, _reason?: string,
): Promise<{ status: SubscriptionStatus }> {
  const current = await findOrgSubscription(db, organizationId);
  if (!current) throw new Error("No subscription found for organization");

  const currentStatus = current.status as SubscriptionStatus;
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed?.has(newStatus)) {
    throw new Error(`Invalid subscription transition: ${currentStatus} → ${newStatus}`);
  }

  await updateSubStatus(db, organizationId, newStatus);
  return { status: newStatus };
}

// ---------------------------------------------------------------------------
// checkAndTransitionSubscription — DEPRECATED: use processOrganizationBilling
// ---------------------------------------------------------------------------
/**
 * @deprecated Use `processOrganizationBilling` from billing-cron.service.ts instead.
 * This function duplicates time-based transition logic that is now canonically
 * handled by the billing cron. Kept for backwards compatibility with existing tests.
 */
export async function checkAndTransitionSubscription(
  db: DrizzleDb, organizationId: string, now: number,
): Promise<{ status: SubscriptionStatus }> {
  const current = await findOrgSubscription(db, organizationId);
  if (!current) return { status: "cancelled" };

  const status = current.status as SubscriptionStatus;
  const periodEnd = toDateMs(current.currentPeriodEnd);
  const trialEnd = toDateMs(current.trialEndsAt);

  if (status === "trial" && trialEnd > 0 && now > trialEnd + SEVEN_DAYS_MS) {
    await updateSubStatus(db, organizationId, "suspended");
    return { status: "suspended" };
  }
  if (status === "active" && periodEnd > 0 && now > periodEnd) {
    await updateSubStatus(db, organizationId, "past_due");
    return { status: "past_due" };
  }
  if (status === "past_due" && periodEnd > 0 && now > periodEnd + SEVEN_DAYS_MS) {
    await updateSubStatus(db, organizationId, "suspended");
    return { status: "suspended" };
  }
  if (status === "suspended" && periodEnd > 0 && now > periodEnd + SEVEN_DAYS_MS + THIRTY_DAYS_MS) {
    await updateSubStatus(db, organizationId, "cancelled");
    return { status: "cancelled" };
  }
  return { status };
}

// ---------------------------------------------------------------------------
// getOrgPlanName — resolves plan name from subscription + plan join
// ---------------------------------------------------------------------------
export async function getOrgPlanName(
  db: DrizzleDb, organizationId: string,
): Promise<PlanName> {
  const sub = await findOrgSubscription(db, organizationId);
  if (!sub) throw new Error("No subscription found for organization");
  if (sub.status === "trial") return "trial";

  const planRow = await db.select({ name: subscriptionPlans.name })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, sub.planId)).get();

  return mapPlanName(planRow?.name ?? null);
}