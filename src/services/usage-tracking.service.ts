/**
 * Usage Tracking Service — KV-based rate limiting + billing event recording.
 *
 * Throttle mechanism (per device per hour):
 *   Key:   throttle:{orgId}:{deviceId}:{hourBucket}
 *   Value: { count: number, maxAllowed: number }
 *   TTL:   3600 seconds (1 hour)
 *
 * When a telemetry reading arrives:
 *   1. Check KV throttle key for this org + device + current hour
 *   2. If count < maxAllowed → accept, increment counter
 *   3. If count >= maxAllowed → reject (429-style)
 *   4. First reading of the hour → create key with TTL 3600
 *
 * Every accepted OR rejected reading creates a billing_events row for analytics.
 */
import { eq } from "drizzle-orm";
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
// checkThrottle — checks KV throttle counter, returns allowance status
// ---------------------------------------------------------------------------
export async function checkThrottle(
  kv: KVNamespace,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
): Promise<ThrottleResult> {
  const key = buildThrottleKey(organizationId, deviceId);
  const maxAllowed = getReadingsPerHourLimit(planName);
  const raw = await kv.get(key);

  if (!raw) {
    // First reading of the hour — create the key with TTL
    const initialValue = JSON.stringify({ count: 0, maxAllowed });
    await kv.put(key, initialValue, { expirationTtl: 3600 });
    return { allowed: true, currentCount: 0, maxAllowed };
  }

  const parsed: { count: number; maxAllowed: number } = JSON.parse(raw);
  const allowed = parsed.count < maxAllowed;
  return { allowed, currentCount: parsed.count, maxAllowed };
}

// ---------------------------------------------------------------------------
// incrementThrottleCounter — increments KV counter after accepting a reading
// ---------------------------------------------------------------------------
export async function incrementThrottleCounter(
  kv: KVNamespace,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
): Promise<void> {
  const key = buildThrottleKey(organizationId, deviceId);
  const maxAllowed = getReadingsPerHourLimit(planName);
  const raw = await kv.get(key);

  let newCount: number;
  if (!raw) {
    newCount = 1;
  } else {
    const parsed: { count: number; maxAllowed: number } = JSON.parse(raw);
    newCount = parsed.count + 1;
  }

  await kv.put(key, JSON.stringify({ count: newCount, maxAllowed }), { expirationTtl: 3600 });
}

// ---------------------------------------------------------------------------
// recordBillingEvent — persists a billing_events row in D1 via Drizzle
// ---------------------------------------------------------------------------
export async function recordBillingEvent(
  db: DrizzleDb,
  organizationId: string,
  deviceId: string,
  eventType: "api_call_tuya" | "api_call_modbus",
  metadata?: { rejectionReason?: string },
): Promise<void> {
  await db.insert(billingEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    deviceSubscriptionId: `sub-${organizationId}`,
    eventTimestamp: new Date(),
    eventType,
    deviceExternalId: deviceId,
    sensorCount: 1,
  }).run();
}

// ---------------------------------------------------------------------------
// checkAndRecordUsage — orchestrator: throttle check + counter + event
// ---------------------------------------------------------------------------
export async function checkAndRecordUsage(
  kv: KVNamespace,
  db: DrizzleDb,
  organizationId: string,
  deviceId: string,
  planName: PlanName,
  eventType: "api_call_tuya" | "api_call_modbus",
): Promise<ThrottleResult> {
  const throttleResult = await checkThrottle(kv, organizationId, deviceId, planName);

  if (throttleResult.allowed) {
    await incrementThrottleCounter(kv, organizationId, deviceId, planName);
    await recordBillingEvent(db, organizationId, deviceId, eventType);
    return {
      ...throttleResult,
      currentCount: throttleResult.currentCount + 1,
    };
  }

  // Rejected — still record the event for analytics with rejection reason
  await recordBillingEvent(db, organizationId, deviceId, eventType, {
    rejectionReason: "quota_exceeded",
  });

  return throttleResult;
}