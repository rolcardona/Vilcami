/**
 * Billing Integration Tests — full lifecycle + middleware + webhook + cron flows.
 * Tests verify that multiple billing modules work together correctly.
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
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ meta: {} }),
    batch: vi.fn().mockResolvedValue(undefined),
  };
}

let mockDb: ReturnType<typeof createMockDb>;

// ---------------------------------------------------------------------------
// Mocks — hoisted module dependencies
// ---------------------------------------------------------------------------
vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => mockDb),
}));

vi.mock("../../services/subscription.service", () => ({
  getSubscriptionStatus: vi.fn(),
  activateSubscription: vi.fn(),
  transitionSubscriptionStatus: vi.fn(),
  getOrgPlanName: vi.fn(),
}));

vi.mock("../../services/plan-feature.service", () => ({
  getDeviceLimit: vi.fn(),
  getPlanFeatures: vi.fn(),
  hasFeature: vi.fn(),
  PLAN_FEATURES: {
    trial: { maxDevices: 3, readingsPerHour: 1, dataRetentionDays: 7, alertLevels: ["p0", "p1"], features: [] },
    starter: { maxDevices: 5, readingsPerHour: 60, dataRetentionDays: 30, alertLevels: ["p0", "p1", "p2", "p3"], features: [] },
    professional: { maxDevices: 15, readingsPerHour: 720, dataRetentionDays: 90, alertLevels: ["p0", "p1", "p2", "p3"], features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"] },
    enterprise: { maxDevices: Infinity, readingsPerHour: Infinity, dataRetentionDays: 365, alertLevels: ["p0", "p1", "p2", "p3"], features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"] },
  },
}));

vi.mock("../../schema/index", () => ({
  deviceSubscriptions: {
    id: "id", organizationId: "organization_id", deviceId: "device_id",
    planId: "plan_id", status: "status",
    trialStartsAt: "trial_starts_at", trialEndsAt: "trial_ends_at",
    currentPeriodStart: "current_period_start", currentPeriodEnd: "current_period_end",
    addOns: "add_ons", createdAt: "created_at",
  },
  subscriptionPlans: { id: "id", name: "name" },
  devices: { id: "id", organizationId: "organization_id" },
  payments: { id: "id", organizationId: "organization_id" },
  wompiEvents: { id: "id", organizationId: "organization_id", wompiEventId: "wompi_event_id" },
  billingEvents: { id: "id", organizationId: "organization_id" },
}));

vi.mock("../../schema/organizations", () => ({
  organizations: { id: "id", name: "name" },
}));

vi.mock("../../adapters/wompi-adapter", () => ({
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
  createPaymentLink: vi.fn(),
}));

import { getSubscriptionStatus, transitionSubscriptionStatus } from "../../services/subscription.service";
import { requireSubscription, requireFeature, requireDeviceQuota } from "../../middleware/subscription.middleware";
import { verifyWebhookSignature, handleWebhookEvent } from "../../adapters/wompi-adapter";
import { runBillingValidationCycle } from "../../services/billing-cron.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = "org-integration-001";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {} as KVNamespace,
    THROTTLE_KV: {} as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

function makeSub(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    organizationId: ORG_ID, planName: "starter", status: "active",
    currentPeriodStart: Date.now() - THIRTY_DAYS_MS,
    currentPeriodEnd: Date.now() + THIRTY_DAYS_MS,
    deviceCount: 2, maxDevices: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Full subscription lifecycle flow
// ---------------------------------------------------------------------------
describe("Full subscription lifecycle: trial → active → past_due → suspended → cancelled", () => {
  beforeEach(() => { vi.resetAllMocks(); mockDb = createMockDb(); });

  it("transitions through the complete lifecycle using service functions", async () => {
    // Step 1: trial → active (payment received)
    const trialSub = makeSub({ status: "trial", planName: "trial", deviceCount: 1, maxDevices: 3 });
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(trialSub);
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "active" });

    const activeResult = await transitionSubscriptionStatus(mockDb, ORG_ID, "active");
    expect(activeResult.status).toBe("active");

    // Step 2: active → past_due (period ended)
    const activeSub = makeSub({ status: "active" });
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(activeSub);
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "past_due" });

    const pastDueResult = await transitionSubscriptionStatus(mockDb, ORG_ID, "past_due");
    expect(pastDueResult.status).toBe("past_due");

    // Step 3: past_due → suspended (grace period expired)
    const pastDueSub = makeSub({ status: "past_due" });
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(pastDueSub);
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "suspended" });

    const suspendedResult = await transitionSubscriptionStatus(mockDb, ORG_ID, "suspended");
    expect(suspendedResult.status).toBe("suspended");

    // Step 4: suspended → cancelled (30 days past)
    const suspendedSub = makeSub({ status: "suspended" });
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(suspendedSub);
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "cancelled" });

    const cancelledResult = await transitionSubscriptionStatus(mockDb, ORG_ID, "cancelled");
    expect(cancelledResult.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// 2. Middleware + route integration
// ---------------------------------------------------------------------------
describe("Middleware + route integration", () => {
  beforeEach(() => { vi.resetAllMocks(); mockDb = createMockDb(); });

  it("requireSubscription blocks suspended orgs with 402", async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ status: "suspended", deviceCount: 5 }),
    );

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => { c.set("organizationId", ORG_ID); await next(); });
    app.use("*", requireSubscription());
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, createTestEnv());
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("subscription_suspended");
  });

  it("requireFeature blocks starter plan from advanced_escalation with 403", async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ planName: "starter", deviceCount: 2 }),
    );
    const { hasFeature } = await import("../../services/plan-feature.service");
    vi.mocked(hasFeature).mockReturnValueOnce(false);

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => { c.set("organizationId", ORG_ID); await next(); });
    app.use("*", requireFeature("advanced_escalation" as FeatureName));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, createTestEnv());
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentPlan: string };
    expect(body.error).toBe("feature_not_included");
    expect(body.currentPlan).toBe("starter");
  });

  it("requireDeviceQuota blocks when device count exceeds plan limit with 403", async () => {
    const { getDeviceLimit } = await import("../../services/plan-feature.service");
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ planName: "trial", status: "trial", deviceCount: 3, maxDevices: 3 }),
    );
    vi.mocked(getDeviceLimit).mockReturnValueOnce(3);

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => { c.set("organizationId", ORG_ID); await next(); });
    app.use("*", requireDeviceQuota());
    app.post("/devices", (c) => c.json({ ok: true }));

    const res = await app.request("/devices", { method: "POST" }, createTestEnv());
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentCount: number };
    expect(body.error).toBe("device_quota_exceeded");
    expect(body.currentCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Webhook processing flow
// ---------------------------------------------------------------------------
describe("Webhook processing flow: valid HMAC → payment record → subscription activation", () => {
  beforeEach(() => { vi.resetAllMocks(); mockDb = createMockDb(); });

  it("processes a Wompi webhook with valid HMAC and activates subscription", async () => {
    const webhookPayload = {
      event: "transaction.approved",
      data: {
        transaction: {
          id: "txn-webhook-001", amountInCents: 850000, currency: "COP",
          status: "APPROVED", paymentMethod: "card",
          reference: `${ORG_ID}:plan-starter:1700000000`, createdAt: "2026-05-12T10:00:00Z",
        },
      },
      timestamp: "2026-05-12T10:00:00Z",
      signature: { checksum: "valid-checksum", properties: ["transaction.id"] },
    };

    vi.mocked(verifyWebhookSignature).mockResolvedValueOnce(true);
    vi.mocked(handleWebhookEvent).mockResolvedValueOnce({ processed: true });

    const app = new Hono<{ Bindings: Env }>();
    app.post("/api/webhooks/wompi", async (c) => {
      const transactionHash = c.req.header("x-transaction-hash") ?? "";
      const timestamp = c.req.header("timestamp") ?? "";
      const rawBody = await c.req.text();
      const isValid = await verifyWebhookSignature(
        c.env.WOMPI_EVENT_INTEGRITY_KEY, rawBody, timestamp, transactionHash,
      );
      if (!isValid) return c.json({ error: "invalid_signature" }, 400);
      const payload = JSON.parse(rawBody);
      const orgId = payload.data.transaction.reference.split(":")[0];
      const result = await handleWebhookEvent(c.env, orgId, payload);
      return c.json({ processed: result.processed });
    });

    const env = createTestEnv();
    const res = await app.request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hmac-hash",
        "timestamp": "2026-05-12T10:00:00Z",
      },
      body: JSON.stringify(webhookPayload),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { processed: boolean };
    expect(body.processed).toBe(true);
    expect(verifyWebhookSignature).toHaveBeenCalledWith(
      "test-integrity-key",
      JSON.stringify(webhookPayload),
      "2026-05-12T10:00:00Z",
      "valid-hmac-hash",
    );
    expect(handleWebhookEvent).toHaveBeenCalledWith(env, ORG_ID, expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// 4. Billing cron transitions
// ---------------------------------------------------------------------------
describe("Billing cron correctly transitions subscriptions based on time", () => {
  let env: Env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb = createMockDb();
    env = createTestEnv();
  });

  it("transitions past_due org to suspended when past 7-day grace period", async () => {
    const now = Date.now();
    const periodEnd = now - SEVEN_DAYS_MS - 1000;
    mockDb.all.mockResolvedValueOnce([{ id: ORG_ID }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ status: "past_due", currentPeriodEnd: periodEnd }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "suspended" });

    const results = await runBillingValidationCycle(env);

    expect(results).toHaveLength(1);
    expect(results[0].organizationId).toBe(ORG_ID);
    expect(results[0].transitionedTo).toBe("suspended");
    expect(transitionSubscriptionStatus).toHaveBeenCalledWith(
      mockDb, ORG_ID, "suspended", expect.any(String),
    );
  });

  it("transitions suspended org to cancelled when past 30-day window", async () => {
    const now = Date.now();
    const periodEnd = now - SEVEN_DAYS_MS - THIRTY_DAYS_MS - 1000;
    mockDb.all.mockResolvedValueOnce([{ id: ORG_ID }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ status: "suspended", currentPeriodEnd: periodEnd }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValueOnce({ status: "cancelled" });

    const results = await runBillingValidationCycle(env);

    expect(results[0].transitionedTo).toBe("cancelled");
  });

  it("does NOT transition active org within valid billing period", async () => {
    mockDb.all.mockResolvedValueOnce([{ id: ORG_ID }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValueOnce(
      makeSub({ status: "active" }),
    );

    const results = await runBillingValidationCycle(env);

    expect(results[0].transitionedTo).toBeUndefined();
    expect(results[0].status).toBe("active");
    expect(transitionSubscriptionStatus).not.toHaveBeenCalled();
  });
});