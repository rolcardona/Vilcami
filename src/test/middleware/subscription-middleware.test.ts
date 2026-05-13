/**
 * Tests for Subscription Middleware — TDD: written BEFORE implementation.
 *
 * Covers: requireSubscription, requireFeature, requireDeviceQuota.
 * Uses Hono app with mocked service layer to test middleware in isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Env } from "../../types/env";
import type { FeatureName, SubscriptionResponse } from "../../types/billing.types";

// ---------------------------------------------------------------------------
// Mock services — vi.mock is hoisted, so factories must be self-contained
// ---------------------------------------------------------------------------
vi.mock("../../services/subscription.service", () => ({
  getSubscriptionStatus: vi.fn(),
  getOrgPlanName: vi.fn(),
}));

vi.mock("../../services/plan-feature.service", () => ({
  hasFeature: vi.fn(),
  getDeviceLimit: vi.fn(),
  PLAN_FEATURES: {
    trial: { maxDevices: 3, readingsPerHour: 1, dataRetentionDays: 7, alertLevels: ["p0", "p1"], features: [] },
    starter: { maxDevices: 5, readingsPerHour: 60, dataRetentionDays: 30, alertLevels: ["p0", "p1", "p2", "p3"], features: [] },
    professional: { maxDevices: 15, readingsPerHour: 720, dataRetentionDays: 90, alertLevels: ["p0", "p1", "p2", "p3"], features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"] },
    enterprise: { maxDevices: Infinity, readingsPerHour: Infinity, dataRetentionDays: 365, alertLevels: ["p0", "p1", "p2", "p3"], features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"] },
  },
}));

vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => ({})),
}));

import {
  requireSubscription,
  requireFeature,
  requireDeviceQuota,
} from "../../middleware/subscription.middleware";

import { getSubscriptionStatus } from "../../services/subscription.service";
import { hasFeature, getDeviceLimit, PLAN_FEATURES } from "../../services/plan-feature.service";

// ---------------------------------------------------------------------------
// Typed mock references (after import so hoisting resolves)
// ---------------------------------------------------------------------------
const mockGetSubscriptionStatus = vi.mocked(getSubscriptionStatus);
const mockHasFeature = vi.mocked(hasFeature);
const mockGetDeviceLimit = vi.mocked(getDeviceLimit);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const ORG_ID = "org-test-001";

/** Minimal valid SubscriptionResponse for tests */
function makeSub(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
  return {
    organizationId: ORG_ID,
    planName: "starter",
    status: "active",
    currentPeriodStart: Date.now() - 30 * 24 * 60 * 60 * 1000,
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    deviceCount: 2,
    maxDevices: 5,
    ...overrides,
  };
}

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
    AI: {} as unknown as Ai,
  };
}

/** Generic Hono middleware handler type (broad enough for all 3 middleware) */
type MiddlewareHandler = (c: Context<{ Bindings: Env }>, next: Next) => Promise<Response | undefined>;

function createAppWithMiddleware(middleware: MiddlewareHandler): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.set("organizationId", ORG_ID);
    await next();
  });
  app.use("*", middleware);
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// requireSubscription
// ---------------------------------------------------------------------------
describe("requireSubscription", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes through when subscription is trial", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "trial", status: "trial", deviceCount: 1, maxDevices: 3 }));

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("passes through when subscription is active", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ status: "active" }));

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
  });

  it("passes through when subscription is past_due and sets X-Subscription-Past-Due header", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ status: "past_due" }));

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Subscription-Past-Due")).toBe("true");
  });

  it("returns 402 when subscription is suspended", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ status: "suspended", deviceCount: 5 }));

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(402);
    const body = await res.json() as { error: string; upgradeInfo: Record<string, unknown> };
    expect(body.error).toBe("subscription_suspended");
    expect(body.upgradeInfo).toBeDefined();
    expect(body.upgradeInfo.currentStatus).toBe("suspended");
  });

  it("returns 401 when subscription is cancelled", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ status: "cancelled", deviceCount: 5 }));

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string; upgradeInfo: Record<string, unknown> };
    expect(body.error).toBe("subscription_cancelled");
    expect(body.upgradeInfo).toBeDefined();
    expect(body.upgradeInfo.currentStatus).toBe("cancelled");
  });

  it("returns 402 with no_subscription error when no subscription found", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(null);

    const app = createAppWithMiddleware(requireSubscription());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(402);
    const body = await res.json() as { error: string; upgradeInfo: Record<string, unknown> };
    expect(body.error).toBe("no_subscription");
    expect(body.upgradeInfo).toBeDefined();
    expect((body.upgradeInfo as { currentStatus: string }).currentStatus).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// requireFeature
// ---------------------------------------------------------------------------
describe("requireFeature", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes through when professional plan includes ai_diagnostic", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "professional", deviceCount: 5, maxDevices: 15 }));
    mockHasFeature.mockReturnValueOnce(true);

    const app = createAppWithMiddleware(requireFeature("ai_diagnostic" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
    expect(mockHasFeature).toHaveBeenCalledWith("professional", "ai_diagnostic");
  });

  it("returns 403 feature_not_included when starter plan lacks ai_diagnostic", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "starter", deviceCount: 2 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("ai_diagnostic" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; requiredPlan: string; currentPlan: string; upgradeUrl: string };
    expect(body.error).toBe("feature_not_included");
    expect(body.currentPlan).toBe("starter");
    expect(body.upgradeUrl).toBe("/api/billing/plans");
  });

  it("returns 403 feature_not_included when trial plan has no features", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "trial", status: "trial", deviceCount: 1, maxDevices: 3 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("ai_diagnostic" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentPlan: string };
    expect(body.error).toBe("feature_not_included");
    expect(body.currentPlan).toBe("trial");
  });

  it("passes through when enterprise plan includes compliance_reports", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "enterprise", deviceCount: 10, maxDevices: Infinity }));
    mockHasFeature.mockReturnValueOnce(true);

    const app = createAppWithMiddleware(requireFeature("compliance_reports" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
    expect(mockHasFeature).toHaveBeenCalledWith("enterprise", "compliance_reports");
  });

  it("returns 403 feature_not_included when no subscription found (null)", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(null);

    const app = createAppWithMiddleware(requireFeature("ai_diagnostic" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentPlan: string };
    expect(body.error).toBe("feature_not_included");
    expect(body.currentPlan).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// requireDeviceQuota
// ---------------------------------------------------------------------------
describe("requireDeviceQuota", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes through when device count is under limit", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ deviceCount: 3 }));

    const app = createAppWithMiddleware(requireDeviceQuota());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
  });

  it("returns 403 device_quota_exceeded when at device limit", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ deviceCount: 5, maxDevices: 5 }));
    mockGetDeviceLimit.mockReturnValueOnce(5);

    const app = createAppWithMiddleware(requireDeviceQuota());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentCount: number; maxAllowed: number; upgradeUrl: string };
    expect(body.error).toBe("device_quota_exceeded");
    expect(body.currentCount).toBe(5);
    expect(body.maxAllowed).toBe(5);
    expect(body.upgradeUrl).toBe("/api/billing/plans");
  });

  it("always passes through for enterprise plan (Infinity limit)", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "enterprise", deviceCount: 999, maxDevices: Infinity }));
    mockGetDeviceLimit.mockReturnValueOnce(Infinity);

    const app = createAppWithMiddleware(requireDeviceQuota());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(200);
  });

  it("returns 403 when trial has 3 devices at max", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "trial", status: "trial", deviceCount: 3, maxDevices: 3 }));
    mockGetDeviceLimit.mockReturnValueOnce(3);

    const app = createAppWithMiddleware(requireDeviceQuota());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentCount: number; maxAllowed: number };
    expect(body.error).toBe("device_quota_exceeded");
    expect(body.currentCount).toBe(3);
    expect(body.maxAllowed).toBe(3);
  });

  it("returns 403 device_quota_exceeded when no subscription found (null)", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(null);

    const app = createAppWithMiddleware(requireDeviceQuota());
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; currentCount: number; maxAllowed: number };
    expect(body.error).toBe("device_quota_exceeded");
    expect(body.currentCount).toBe(0);
    expect(body.maxAllowed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMinimumPlanForFeature — dynamic derivation from PLAN_FEATURES (Finding #21)
// ---------------------------------------------------------------------------
describe("getMinimumPlanForFeature — dynamic derivation from PLAN_FEATURES", () => {
  // Import the module to access getMinimumPlanForFeature indirectly
  // The function is not exported, so we test it through requireFeature responses

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("derives minimum plan for ai_diagnostic from PLAN_FEATURES", async () => {
    // ai_diagnostic is in professional and enterprise plans
    // When a trial user lacks it, requireFeature should report "professional" as requiredPlan
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "trial", status: "trial", deviceCount: 1, maxDevices: 3 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("ai_diagnostic" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; requiredPlan: string };
    expect(body.requiredPlan).toBe("professional");
  });

  it("derives minimum plan for compliance_reports from PLAN_FEATURES", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "starter", deviceCount: 2 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("compliance_reports" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; requiredPlan: string };
    expect(body.requiredPlan).toBe("professional");
  });

  it("derives minimum plan for advanced_escalation from PLAN_FEATURES", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "starter", deviceCount: 2 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("advanced_escalation" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; requiredPlan: string };
    expect(body.requiredPlan).toBe("professional");
  });

  it("falls back to enterprise for unknown feature not in any plan", async () => {
    // Test that unknown features fall back to "enterprise"
    // Since the dynamic derivation iterates all plans, a feature not in any returns "enterprise"
    mockGetSubscriptionStatus.mockResolvedValueOnce(makeSub({ planName: "starter", deviceCount: 2 }));
    mockHasFeature.mockReturnValueOnce(false);

    const app = createAppWithMiddleware(requireFeature("nonexistent_feature" as FeatureName));
    const res = await app.request("/test", undefined, createTestEnv());

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; requiredPlan: string };
    expect(body.requiredPlan).toBe("enterprise");
  });
});