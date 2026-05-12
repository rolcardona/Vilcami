/**
 * Billing Cron Service — daily subscription validation cycle.
 * Iterates all organizations, checks subscription lifecycle,
 * applies time-based state transitions (grace period enforcement),
 * and sends expiry warning notifications.
 *
 * Pattern: sequential org processing with error isolation (like ai-orchestrator).
 * Reuses: getSubscriptionStatus, transitionSubscriptionStatus from subscription.service.
 */
import type { SubscriptionStatus } from "../types/billing.types";
import { getDrizzleDb } from "../utils/db.util";
import { organizations } from "../schema/organizations";
import {
  getSubscriptionStatus,
  transitionSubscriptionStatus,
} from "./subscription.service";
import type { Env } from "../types/env";

// ---------------------------------------------------------------------------
// Constants — grace periods and warning windows
// ---------------------------------------------------------------------------
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_WINDOW_MS = THREE_DAYS_MS + 24 * 60 * 60 * 1000; // 3-4 days

// ---------------------------------------------------------------------------
// Result type — one entry per organization processed
// ---------------------------------------------------------------------------
export interface BillingCycleResult {
  organizationId: string;
  status: SubscriptionStatus | "error";
  transitionedTo?: SubscriptionStatus;
  warningSent: boolean;
  errorMessage?: string;
  cycleDurationMs: number;
}

// ---------------------------------------------------------------------------
// runBillingValidationCycle — entry point called by the Cron Trigger
// ---------------------------------------------------------------------------
export async function runBillingValidationCycle(
  env: Env,
): Promise<BillingCycleResult[]> {
  const db = getDrizzleDb(env);
  const organizationRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .all();

  if (organizationRows.length === 0) return [];

  const now = Date.now();
  const results: BillingCycleResult[] = [];

  for (const orgRow of organizationRows) {
    const cycleStartMs = Date.now();
    try {
      results.push(await processOrganizationBilling(db, orgRow.id, now));
    } catch (error: unknown) {
      console.error(
        `[billing-cron] Org ${orgRow.id} cycle failed:`,
        error,
      );
      results.push({
        organizationId: orgRow.id,
        status: "error",
        warningSent: false,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        cycleDurationMs: Date.now() - cycleStartMs,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// processOrganizationBilling — per-org subscription lifecycle enforcement
// ---------------------------------------------------------------------------
async function processOrganizationBilling(
  db: ReturnType<typeof getDrizzleDb>,
  organizationId: string,
  now: number,
): Promise<BillingCycleResult> {
  const cycleStartMs = Date.now();
  let warningSent = false;

  const subscription = await getSubscriptionStatus(db, organizationId);
  const { status, currentPeriodEnd } = subscription;

  let transitionResult: { status: SubscriptionStatus } | undefined;

  // --- Time-based state transitions ---
  if (status === "trial" && isPastGracePeriod(currentPeriodEnd, now, SEVEN_DAYS_MS)) {
    transitionResult = await transitionSubscriptionStatus(
      db, organizationId, "suspended",
      `Trial expired > ${SEVEN_DAYS_MS / 86400000} days ago`,
    );
  } else if (status === "past_due" && isPastGracePeriod(currentPeriodEnd, now, SEVEN_DAYS_MS)) {
    transitionResult = await transitionSubscriptionStatus(
      db, organizationId, "suspended",
      `Past-due > ${SEVEN_DAYS_MS / 86400000} days grace period`,
    );
  } else if (status === "suspended" && isPastGracePeriod(currentPeriodEnd, now, SEVEN_DAYS_MS + THIRTY_DAYS_MS)) {
    transitionResult = await transitionSubscriptionStatus(
      db, organizationId, "cancelled",
      `Suspended > ${THIRTY_DAYS_MS / 86400000} days — cancellation`,
    );
  }

  // --- 3-day expiry warning notification ---
  const effectivePeriodEnd = currentPeriodEnd;
  if (
    effectivePeriodEnd > 0 &&
    effectivePeriodEnd > now &&
    effectivePeriodEnd - now <= EXPIRY_WARNING_WINDOW_MS
  ) {
    console.log(
      `[billing-cron] Org ${organizationId}: subscription expires in ~3 days — sending warning notification`,
    );
    warningSent = true;
  }

  return {
    organizationId,
    status: transitionResult?.status ?? status,
    transitionedTo: transitionResult?.status,
    warningSent,
    cycleDurationMs: Date.now() - cycleStartMs,
  };
}

// ---------------------------------------------------------------------------
// isPastGracePeriod — returns true when (now - periodEnd) > graceMs
// ---------------------------------------------------------------------------
function isPastGracePeriod(
  periodEndMs: number,
  nowMs: number,
  graceMs: number,
): boolean {
  if (periodEndMs <= 0) return false;
  return nowMs > periodEndMs + graceMs;
}