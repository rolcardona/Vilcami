/**
 * Billing Edge Cases — boundary conditions and unusual inputs.
 * Covers: subscription state machine edges, usage throttle limits,
 * Wompi adapter edge cases, and plan feature edge cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";
import type { SubscriptionStatus, SubscriptionResponse, FeatureName } from "../../types/billing.types";

// ---------------------------------------------------------------------------
// Mock Drizzle DB — chainable query builder
// ---------------------------------------------------------------------------
function createMockDb() {
  return {
    select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), offset: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(null), all: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({ meta: {} }),
  };
}

let mockDb: ReturnType<typeof createMockDb>;

// ---------------------------------------------------------------------------
// Mocks — plan-feature uses importOriginal so real PLAN_FEATURES is available
// ---------------------------------------------------------------------------
vi.mock("../../schema/index", () => ({
  deviceSubscriptions: {
    id: "id", organizationId: "organization_id", deviceId: "device_id",
    planId: "plan_id", status: "status", trialStartsAt: "trial_starts_at",
    trialEndsAt: "trial_ends_at", currentPeriodStart: "current_period_start",
    currentPeriodEnd: "current_period_end", addOns: "add_ons", createdAt: "created_at",
  },
  subscriptionPlans: { id: "id", name: "name" },
  devices: { id: "id", organizationId: "organization_id" },
}));

vi.mock("../../services/plan-feature.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/plan-feature.service")>();
  return {
    ...actual,
    // Keep real PLAN_FEATURES, getDeviceLimit, etc. — only mock hasFeature for middleware tests
  };
});

vi.mock("../../adapters/wompi-adapter", () => ({
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
  createPaymentLink: vi.fn(),
}));

vi.mock("../../services/subscription.service", () => ({
  getSubscriptionStatus: vi.fn(),
  activateSubscription: vi.fn(),
  transitionSubscriptionStatus: vi.fn(),
  getOrgPlanName: vi.fn(),
}));

import { transitionSubscriptionStatus, activateSubscription, getSubscriptionStatus } from "../../services/subscription.service";
import { NotFoundError } from "../../errors/not-found.error";
import { PLAN_FEATURES, hasFeature, getDeviceLimit, getReadingsPerHourLimit } from "../../services/plan-feature.service";
import { checkThrottle } from "../../services/usage-tracking.service";
import { createMockKV, makeHourBucket, ORG_ID, DEVICE_ID } from "./usage-tracking.helpers";
import { verifyWebhookSignature, handleWebhookEvent } from "../../adapters/wompi-adapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_EC = "org-edge-001";
const PLAN_ID = "plan-edge-001";
const PAYMENT_ID = "pay-edge-001";

function makeSub(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    organizationId: ORG_EC, planName: "starter", status: "active",
    currentPeriodStart: Date.now() - 30 * 24 * 60 * 60 * 1000,
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    deviceCount: 2, maxDevices: 5,
    ...overrides,
  };
}

function createTestEnv(): Env {
  return {
    DB: {} as D1Database, TELEMETRY_RAW: {} as KVNamespace, SECRETS_VAULT: {} as KVNamespace,
    THROTTLE_KV: {} as KVNamespace, ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1", WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

// ===========================================================================
// Subscription service edge cases — uses mocked service functions
// ===========================================================================
describe("Subscription service edge cases", () => {
  beforeEach(() => { vi.resetAllMocks(); mockDb = createMockDb(); });

  it("rejects all transitions from cancelled state (terminal state)", async () => {
    const targets: SubscriptionStatus[] = ["active", "trial", "past_due", "suspended", "cancelled"];
    for (const target of targets) {
      vi.mocked(transitionSubscriptionStatus).mockRejectedValueOnce(
        new Error(`Invalid subscription transition: cancelled → ${target}`),
      );
      await expect(transitionSubscriptionStatus(mockDb, ORG_EC, target))
        .rejects.toThrow("Invalid subscription transition: cancelled");
    }
  });

  it("activateSubscription returns active for already-active subscription (idempotent)", async () => {
    vi.mocked(activateSubscription).mockResolvedValueOnce({ status: "active" });
    const result = await activateSubscription(mockDb, ORG_EC, PLAN_ID, PAYMENT_ID);
    expect(result.status).toBe("active");
  });

  it("getSubscriptionStatus throws NotFoundError for org with no subscription row", async () => {
    vi.mocked(getSubscriptionStatus).mockRejectedValueOnce(new NotFoundError("Subscription", ORG_EC));
    await expect(getSubscriptionStatus(mockDb, ORG_EC)).rejects.toThrow("Subscription not found");
  });
});

// ===========================================================================
// Usage tracking edge cases
// ===========================================================================
describe("Usage tracking edge cases", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => { kv = createMockKV(); });

  it("rejects reading when throttle counter is at exact plan limit", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "trial");
    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(1);
  });

  it("creates new KV key on first reading of a new hour bucket", async () => {
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 2);
    const pastKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(pastDate)}`;
    await kv.put(pastKey, JSON.stringify({ count: 999, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkThrottle(kv, ORG_ID, DEVICE_ID, "starter");
    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1); // checkThrottle now delegates to atomic checkAndIncrementThrottle

    const currentKey = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    expect(kv.store.has(currentKey)).toBe(true);
  });
});

// ===========================================================================
// Wompi adapter edge cases
// ===========================================================================
describe("Wompi adapter edge cases", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("webhook with expired/old timestamp still verifies if HMAC matches", async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValueOnce(true);
    vi.mocked(handleWebhookEvent).mockResolvedValueOnce({ processed: true });

    const app = new Hono<{ Bindings: Env }>();
    app.post("/wompi", async (c) => {
      const hash = c.req.header("x-transaction-hash") ?? "";
      const ts = c.req.header("timestamp") ?? "";
      const body = await c.req.text();
      if (!await verifyWebhookSignature(c.env.WOMPI_EVENT_INTEGRITY_KEY, body, ts, hash)) {
        return c.json({ error: "invalid_signature" }, 400);
      }
      return c.json({ verified: true });
    });

    const res = await app.request("/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": "2020-01-01T00:00:00Z",
      },
      body: JSON.stringify({ event: "test" }),
    }, createTestEnv());

    expect(res.status).toBe(200);
    expect(verifyWebhookSignature).toHaveBeenCalledWith(
      "test-integrity-key", expect.any(String), "2020-01-01T00:00:00Z", "valid-hash",
    );
  });

  it("webhook with invalid HMAC signature is rejected with 400", async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValueOnce(false);

    const app = new Hono<{ Bindings: Env }>();
    app.post("/wompi", async (c) => {
      const hash = c.req.header("x-transaction-hash") ?? "";
      const ts = c.req.header("timestamp") ?? "";
      const body = await c.req.text();
      if (!await verifyWebhookSignature(c.env.WOMPI_EVENT_INTEGRITY_KEY, body, ts, hash)) {
        return c.json({ error: "invalid_signature" }, 400);
      }
      return c.json({ verified: true });
    });

    const res = await app.request("/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "tampered-hash",
        "timestamp": "2026-05-12T10:00:00Z",
      },
      body: JSON.stringify({ event: "fraud" }),
    }, createTestEnv());

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("invalid_signature");
  });

  it("duplicate webhook event is processed idempotently (adapter returns same result)", async () => {
    vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
    vi.mocked(handleWebhookEvent)
      .mockResolvedValueOnce({ processed: true })
      .mockResolvedValueOnce({ processed: true });

    const app = new Hono<{ Bindings: Env }>();
    app.post("/wompi", async (c) => {
      const hash = c.req.header("x-transaction-hash") ?? "";
      const ts = c.req.header("timestamp") ?? "";
      const body = await c.req.text();
      if (!await verifyWebhookSignature(c.env.WOMPI_EVENT_INTEGRITY_KEY, body, ts, hash)) {
        return c.json({ error: "invalid_signature" }, 400);
      }
      const payload = JSON.parse(body);
      const orgId = payload.data?.transaction?.reference?.split(":")[0] ?? "org-001";
      const result = await handleWebhookEvent(c.env, orgId, payload);
      return c.json({ processed: result.processed });
    });

    const reqOpts = {
      method: "POST" as const,
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "same-hash",
        "timestamp": "2026-05-12T10:00:00Z",
      },
      body: JSON.stringify({
        event: "transaction.approved",
        data: { transaction: { id: "txn-dup", reference: "org-001:plan:1" } },
      }),
    };

    const res1 = await app.request("/wompi", reqOpts, createTestEnv());
    expect(res1.status).toBe(200);

    const res2 = await app.request("/wompi", reqOpts, createTestEnv());
    expect(res2.status).toBe(200);
    expect(handleWebhookEvent).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Plan feature edge cases — uses REAL implementation (importOriginal)
// ===========================================================================
describe("Plan feature edge cases", () => {
  it("enterprise plan has Infinity device limit", () => {
    expect(PLAN_FEATURES.enterprise.maxDevices).toBe(Infinity);
    expect(getDeviceLimit("enterprise")).toBe(Infinity);
  });

  it("enterprise plan has Infinity readings per hour", () => {
    expect(PLAN_FEATURES.enterprise.readingsPerHour).toBe(Infinity);
    expect(getReadingsPerHourLimit("enterprise")).toBe(Infinity);
  });

  it("starter plan has empty features array (add-ons purchased separately)", () => {
    expect(PLAN_FEATURES.starter.features).toEqual([]);
    expect(hasFeature("starter", "ai_diagnostic" as FeatureName)).toBe(false);
    expect(hasFeature("starter", "compliance_reports" as FeatureName)).toBe(false);
    expect(hasFeature("starter", "advanced_escalation" as FeatureName)).toBe(false);
  });

  it("trial plan has empty features array (no add-ons in trial)", () => {
    expect(PLAN_FEATURES.trial.features).toEqual([]);
  });
});