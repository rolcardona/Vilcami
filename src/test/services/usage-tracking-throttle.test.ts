import { describe, it, expect, beforeEach } from "vitest";
import { checkThrottle, incrementThrottleCounter } from "../../services/usage-tracking.service";
import type { PlanName } from "../../types/billing.types";
import { createMockKV, makeHourBucket, ORG_ID, DEVICE_ID } from "./usage-tracking.helpers";

// ---------------------------------------------------------------------------
// checkThrottle — KV-based rate limiting
// ---------------------------------------------------------------------------
describe("checkThrottle", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("creates KV key with TTL on first reading of the hour", async () => {
    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(0);
    expect(result.maxAllowed).toBe(60);

    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    expect(kv.store.has(key)).toBe(true);
    const entry = kv.store.get(key)!;
    expect(entry.expirationTtl).toBe(3600);
  });

  it("returns existing count for subsequent readings in same hour", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 5, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(5);
    expect(result.maxAllowed).toBe(60);
  });

  it("returns allowed=false when count equals the plan limit", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "trial");

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(1);
    expect(result.maxAllowed).toBe(1);
  });

  it("returns allowed=false when count exceeds the plan limit (429 rejection)", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 62, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(62);
  });

  it("creates a new key for a different hour bucket (hourly reset)", async () => {
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);
    const pastKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(pastDate)}`;
    await kv.put(pastKey, JSON.stringify({ count: 100, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(0);

    const currentKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    expect(kv.store.has(currentKey)).toBe(true);
  });

  it("returns correct maxAllowed for each plan tier", async () => {
    const planLimits: Record<PlanName, number> = {
      trial: 1, starter: 60, professional: 720, enterprise: Infinity,
    };

    for (const [plan, expectedLimit] of Object.entries(planLimits) as Array<[PlanName, number]>) {
      const result = await checkThrottle(kv, `org-${plan}`, `dev-${plan}`, plan);
      expect(result.maxAllowed).toBe(expectedLimit);
    }
  });
});

// ---------------------------------------------------------------------------
// incrementThrottleCounter — KV counter update
// ---------------------------------------------------------------------------
describe("incrementThrottleCounter", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("creates KV key with count=1 when no prior key exists", async () => {
    await incrementThrottleCounter(kv, ORG_ID, DEVICE_ID, "starter");

    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(1);
    expect(parsed.maxAllowed).toBe(60);
    expect(raw.expirationTtl).toBe(3600);
  });

  it("increments existing counter", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 5, maxAllowed: 60 }), { expirationTtl: 3600 });

    await incrementThrottleCounter(kv, ORG_ID, DEVICE_ID, "starter");

    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(6);
    expect(parsed.maxAllowed).toBe(60);
  });
});