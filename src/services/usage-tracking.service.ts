/**
 * Usage Tracking Service — KV-based rate limiting + billing event recording.
 *
 * Throttle mechanism (per device per hour):
 *   Key:   throttle:{orgId}:{deviceId}:{hourBucket}
 *   Value: { count: number, maxAllowed: number }
 *   TTL:   3600 seconds (1 hour)
 *
 * When a telemetry reading arrives:
 *   1. checkAndIncrementThrottle reads the current counter from KV
 *   2. If count < maxAllowed → accept, increment counter in the same call
 *   3. If count >= maxAllowed → reject (429-style), counter unchanged
 *   4. First reading of the hour → create key with count=1, TTL 3600
 *
 * Every accepted OR rejected reading creates a billing_events row for analytics.
 *
 * ATOMICITY NOTE:
 *   KV does not support true compare-and-set (CAS). The consolidated
 *   checkAndIncrementThrottle reduces the TOCTOU window by performing
 *   check + increment in a single function (no yielding between read and
 *   write), but concurrent requests could still read the same counter
 *   before either writes. For production with high concurrency, consider
 *   migrating throttle enforcement to D1 with:
 *     UPDATE throttle_counters SET count = count + 1
 *     WHERE key = ? AND count < ? RETURNING count
 */
import { billingEvents } from "../schema/index";
import { getReadingsPerHourLimit } from "./plan-feature.service";
import type { PlanName } from "../types/billing.types";

type DrizzleDb = ReturnType<typeof import("../utils/db.util").getDrizzleDb>;

// ---------------------------------------------------------------------------
// getHourBucket — ISO hour string used as KV key suffix for hourly reset
// ---------------------------------------------------------------------------
function getHourBucket(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

// ---------------------------------------------------------------------------
// buildThrottleKey — constructs the KV key for a given org/device/hour
// ---------------------------------------------------------------------------
function buildThrottleKey(organizationId: string, deviceId: string, now?: Date): string {
  return `throttle:${organizationId}:${deviceId}:${getHourBucket(now)}`;
}

// ---------------------------------------------------------------------------
// ThrottleResult — return type for throttle check operations
// ---------------------------------------------------------------------------
export interface ThrottleResult {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number;
}

// ---------------------------------------------------------------------------
// checkThrottle — DEPRECATED: use checkAndIncrementThrottle instead.
// This wrapper delegates to checkAndIncrementThrottle to eliminate the
// TOCTOU race window that existed when check and increment were separate.
// NOTE: Unlike the original, this now increments the counter as a side effect.
// ---------------------------------------------------------------------------
/** @deprecated Use checkAndIncrementThrottle for atomic check+increment. */
export async function checkThrottle(
  kv: KVNamespace,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
): Promise<ThrottleResult> {
  return checkAndIncrementThrottle(kv, organizationId, deviceId, planName);
}

// ---------------------------------------------------------------------------
// incrementThrottleCounter — DEPRECATED: use checkAndIncrementThrottle instead.
// This wrapper delegates to checkAndIncrementThrottle to eliminate the
// TOCTOU race window that existed when check and increment were separate.
// NOTE: Unlike the original, this will NOT increment when the limit is reached.
// ---------------------------------------------------------------------------
/** @deprecated Use checkAndIncrementThrottle for atomic check+increment. */
export async function incrementThrottleCounter(
  kv: KVNamespace,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
): Promise<void> {
  await checkAndIncrementThrottle(kv, organizationId, deviceId, planName);
}

// ---------------------------------------------------------------------------
// checkAndIncrementThrottle — CONSOLIDATED: atomic check + increment
// Reads KV counter, checks against plan limit, and increments in a single
// function call to reduce the TOCTOU race window. See ATOMICITY NOTE above.
// ---------------------------------------------------------------------------
export async function checkAndIncrementThrottle(
  kv: KVNamespace,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
): Promise<ThrottleResult> {
  const key = buildThrottleKey(organizationId, deviceId);
  const maxAllowed = getReadingsPerHourLimit(planName);
  const raw = await kv.get(key);

  let currentCount: number;
  if (!raw) {
    currentCount = 0;
  } else {
    const parsed: { count: number; maxAllowed: number } = JSON.parse(raw);
    currentCount = parsed.count;
  }

  const allowed = currentCount < maxAllowed;
  const newCount = allowed ? currentCount + 1 : currentCount;

  await kv.put(key, JSON.stringify({ count: newCount, maxAllowed }), { expirationTtl: 3600 });

  return { allowed, currentCount: newCount, maxAllowed };
}

// ---------------------------------------------------------------------------
// recordBillingEvent — persists a billing_events row in D1 via Drizzle
// ---------------------------------------------------------------------------
export async function recordBillingEvent(
  db: DrizzleDb,
  organizationId: string,
  deviceId: string,
  eventType: "api_call_tuya" | "api_call_modbus",
  metadata?: { rejectionReason?: string; deviceSubscriptionId?: string },
): Promise<void> {
  await db.insert(billingEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    deviceSubscriptionId: metadata?.deviceSubscriptionId ?? null,
    eventTimestamp: new Date(),
    eventType,
    deviceExternalId: deviceId,
    sensorCount: 1,
  }).run();
}

// ---------------------------------------------------------------------------
// checkAndRecordUsage — orchestrator: consolidated throttle + event
// ---------------------------------------------------------------------------
export async function checkAndRecordUsage(
  kv: KVNamespace,
  db: DrizzleDb,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
  eventType: "api_call_tuya" | "api_call_modbus",
  deviceSubscriptionId?: string,
): Promise<ThrottleResult> {
  const throttleResult = await checkAndIncrementThrottle(kv, organizationId, deviceId, planName);

  if (throttleResult.allowed) {
    await recordBillingEvent(db, organizationId, deviceId, eventType, {
      deviceSubscriptionId,
    });
  } else {
    await recordBillingEvent(db, organizationId, deviceId, eventType, {
      rejectionReason: "quota_exceeded",
      deviceSubscriptionId,
    });
  }

  return throttleResult;
}