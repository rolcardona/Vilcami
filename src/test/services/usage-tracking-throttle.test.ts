import { describe, it, expect, beforeEach } from "vitest";
import {
  checkAndIncrementThrottle,
  checkThrottle,
  incrementThrottleCounter,
} from "../../services/usage-tracking.service";
import type { PlanName } from "../../types/billing.types";
import { createMockKV, makeHourBucket, ORG_ID, DEVICE_ID } from "./usage-tracking.helpers";

// ---------------------------------------------------------------------------
// checkAndIncrementThrottle — atomic check + increment (no TOCTOU)
// ---------------------------------------------------------------------------
describe("checkAndIncrementThrottle", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("creates KV key with count=1 and TTL on first reading of the hour", async () => {
    const result = await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);
    expect(result.maxAllowed).toBe(60);

    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    const entry = kv.store.get(key)!;
    expect(entry.expirationTtl).toBe(3600);
    const parsed = JSON.parse(entry.value);
    expect(parsed.count).toBe(1);
  });

  it("increments existing counter and returns updated count", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 5, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(6);
    expect(result.maxAllowed).toBe(60);
  });

  it("rejects when count equals the plan limit (429 rejection)", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "trial");

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(1);
    expect(result.maxAllowed).toBe(1);
  });

  it("rejects when count exceeds the plan limit", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 62, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(62);
  });

  it("does NOT increment counter when rejected", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "trial");

    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(1); // unchanged — rejected request must not inflate counter
  });

  it("starts fresh for a different hour bucket (hourly reset)", async () => {
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);
    const pastKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(pastDate)}`;
    await kv.put(pastKey, JSON.stringify({ count: 100, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkAndIncrementThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);

    const currentKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    expect(kv.store.has(currentKey)).toBe(true);
  });

  it("returns correct maxAllowed for each plan tier", async () => {
    const planLimits: Record<PlanName, number> = {
      trial: 1, starter: 60, professional: 720, enterprise: Infinity,
    };

    for (const [plan, expectedLimit] of Object.entries(planLimits) as Array<[PlanName, number]>) {
      const result = await checkAndIncrementThrottle(kv, `org-${plan}`, `dev-${plan}`, plan);
      expect(result.maxAllowed).toBe(expectedLimit);
    }
  });
});

// ---------------------------------------------------------------------------
// checkThrottle — DEPRECATED wrapper (delegates to checkAndIncrementThrottle)
// ---------------------------------------------------------------------------
describe("checkThrottle (deprecated)", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("delegates to checkAndIncrementThrottle: increments on first reading", async () => {
    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1); // incremented by atomic op
    expect(result.maxAllowed).toBe(60);
  });

  it("delegates to checkAndIncrementThrottle: increments existing counter", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 5, maxAllowed: 60 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(6);
  });

  it("delegates to checkAndIncrementThrottle: rejects at limit", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "trial");

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// incrementThrottleCounter — DEPRECATED wrapper (delegates to checkAndIncrementThrottle)
// ---------------------------------------------------------------------------
describe("incrementThrottleCounter (deprecated)", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("delegates to checkAndIncrementThrottle: creates key with count=1", async () => {
    await incrementThrottleCounter(kv, ORG_ID, DEVICE_ID, "starter");

    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(1);
    expect(parsed.maxAllowed).toBe(60);
    expect(raw.expirationTtl).toBe(3600);
  });

  it("delegates to checkAndIncrementThrottle: increments existing counter", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 5, maxAllowed: 60 }), { expirationTtl: 3600 });

    await incrementThrottleCounter(kv, ORG_ID, DEVICE_ID, "starter");

    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(6);
  });

  it("does NOT increment when at limit (atomic check rejects)", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    await incrementThrottleCounter(kv, ORG_ID, DEVICE_ID, "trial");

    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(1); // unchanged — atomic check rejected
  });
});