/**
 * Tests for Billing Cron Service — runBillingValidationCycle.
 * TDD: written BEFORE implementation.
 *
 * Covers: org listing, sequential processing with error isolation,
 * time-based state transitions (trial→suspended, past_due→suspended,
 * suspended→cancelled), grace period enforcement, 3-day expiry warnings,
 * empty org handling, and per-org error logging.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubscriptionStatus } from "../../types/billing.types";

// ---------------------------------------------------------------------------
// Mock Drizzle DB — chainable query builder pattern
// ---------------------------------------------------------------------------
function createMockDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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
// Mocks — modules the cron service depends on
// ---------------------------------------------------------------------------
vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => mockDb),
}));

vi.mock("../../services/subscription.service", () => ({
  getSubscriptionStatus: vi.fn(),
  transitionSubscriptionStatus: vi.fn(),
  checkAndTransitionSubscription: vi.fn(),
}));

vi.mock("../../schema/organizations", () => ({
  organizations: {
    id: "id",
    name: "name",
    countryCode: "country_code",
    currencyCode: "currency_code",
    d1DatabaseId: "d1_database_id",
    createdAt: "created_at",
  },
}));

vi.mock("../../schema/index", () => ({
  deviceSubscriptions: {
    id: "id",
    organizationId: "organization_id",
    deviceId: "device_id",
    planId: "plan_id",
    status: "status",
    trialStartsAt: "trial_starts_at",
    trialEndsAt: "trial_ends_at",
    currentPeriodStart: "current_period_start",
    currentPeriodEnd: "current_period_end",
    addOns: "add_ons",
    createdAt: "created_at",
  },
  subscriptionPlans: {
    id: "id",
    name: "name",
  },
  devices: {
    id: "id",
    organizationId: "organization_id",
  },
}));

import { runBillingValidationCycle, type BillingCycleResult } from "../../services/billing-cron.service";
import { getSubscriptionStatus, transitionSubscriptionStatus } from "../../services/subscription.service";
import type { Env } from "../../types/env";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function createMockEnv(): Env {
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

function makeSubscriptionStatus(
  overrides: Partial<Record<string, unknown>> = {},
): ReturnType<typeof getSubscriptionStatus> extends Promise<infer T> ? T : never {
  return {
    organizationId: "org-001",
    planName: "starter",
    status: "active" as SubscriptionStatus,
    currentPeriodStart: Date.now() - THIRTY_DAYS_MS,
    currentPeriodEnd: Date.now() + THIRTY_DAYS_MS,
    deviceCount: 2,
    maxDevices: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("runBillingValidationCycle", () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDb = createMockDb();
    env = createMockEnv();
  });

  // ---------------------------------------------------------------------------
  // Should list all organizations from D1
  // ---------------------------------------------------------------------------
  it("should list all organizations from D1", async () => {
    mockDb.all.mockResolvedValueOnce([
      { id: "org-001" },
      { id: "org-002" },
      { id: "org-003" },
    ]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({ status: "active" }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValue({ status: "active" });

    const results = await runBillingValidationCycle(env);

    expect(results).toHaveLength(3);
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Should process organizations sequentially with error isolation
  // ---------------------------------------------------------------------------
  it("should process organizations sequentially with error isolation", async () => {
    mockDb.all.mockResolvedValueOnce([{ id: "org-bad" }, { id: "org-good" }]);
    vi.mocked(getSubscriptionStatus)
      .mockRejectedValueOnce(new Error("D1 connection lost"))
      .mockResolvedValueOnce(
        makeSubscriptionStatus({ organizationId: "org-good", status: "active" }),
      );

    const results = await runBillingValidationCycle(env);

    expect(results).toHaveLength(2);
    expect(results[0].organizationId).toBe("org-bad");
    expect(results[0].status).toBe("error");
    expect(results[1].organizationId).toBe("org-good");
    expect(results[1].status).toBe("active");
  });

  // ---------------------------------------------------------------------------
  // Should transition trial subscriptions that expired > 7 days ago to suspended
  // ---------------------------------------------------------------------------
  it("should transition trial subscriptions that expired > 7 days ago to suspended", async () => {
    const now = Date.now();
    const trialEnd = now - SEVEN_DAYS_MS - 1000; // expired > 7 days ago

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "trial",
        currentPeriodEnd: trialEnd,
      }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValue({ status: "suspended" });

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).toHaveBeenCalledWith(
      mockDb,
      "org-001",
      "suspended",
      expect.any(String),
    );
    expect(results[0].status).toBe("suspended");
  });

  // ---------------------------------------------------------------------------
  // Should transition past_due subscriptions > 7 days to suspended
  // ---------------------------------------------------------------------------
  it("should transition past_due subscriptions > 7 days to suspended", async () => {
    const now = Date.now();
    const periodEnd = now - SEVEN_DAYS_MS - 1000; // > 7 days past due

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "past_due",
        currentPeriodEnd: periodEnd,
      }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValue({ status: "suspended" });

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).toHaveBeenCalledWith(
      mockDb,
      "org-001",
      "suspended",
      expect.any(String),
    );
    expect(results[0].status).toBe("suspended");
  });

  // ---------------------------------------------------------------------------
  // Should transition suspended subscriptions > 30 days to cancelled
  // ---------------------------------------------------------------------------
  it("should transition suspended subscriptions > 30 days to cancelled", async () => {
    const now = Date.now();
    // Suspended for > 30 days: periodEnd + 7 days grace + 30 days = periodEnd + 37 days
    const periodEnd = now - SEVEN_DAYS_MS - THIRTY_DAYS_MS - 1000;

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "suspended",
        currentPeriodEnd: periodEnd,
      }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValue({ status: "cancelled" });

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).toHaveBeenCalledWith(
      mockDb,
      "org-001",
      "cancelled",
      expect.any(String),
    );
    expect(results[0].status).toBe("cancelled");
  });

  // ---------------------------------------------------------------------------
  // Should NOT transition trial subscriptions within 7-day grace period
  // ---------------------------------------------------------------------------
  it("should NOT transition trial subscriptions within 7-day grace period", async () => {
    const now = Date.now();
    const trialEnd = now - SEVEN_DAYS_MS + 86400000; // expired less than 7 days ago

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "trial",
        currentPeriodEnd: trialEnd,
      }),
    );

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).not.toHaveBeenCalled();
    expect(results[0].status).toBe("trial");
  });

  // ---------------------------------------------------------------------------
  // Should NOT transition past_due subscriptions within 7-day grace period
  // ---------------------------------------------------------------------------
  it("should NOT transition past_due subscriptions within 7-day grace period", async () => {
    const now = Date.now();
    const periodEnd = now - SEVEN_DAYS_MS + 86400000; // within grace

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "past_due",
        currentPeriodEnd: periodEnd,
      }),
    );

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).not.toHaveBeenCalled();
    expect(results[0].status).toBe("past_due");
  });

  // ---------------------------------------------------------------------------
  // Should NOT transition suspended subscriptions within 30-day grace period
  // ---------------------------------------------------------------------------
  it("should NOT transition suspended subscriptions within 30-day grace period", async () => {
    const now = Date.now();
    // Suspended only 10 days ago (well within 30-day grace)
    const periodEnd = now - SEVEN_DAYS_MS - 10 * 24 * 60 * 60 * 1000;

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "suspended",
        currentPeriodEnd: periodEnd,
      }),
    );

    const results = await runBillingValidationCycle(env);

    expect(transitionSubscriptionStatus).not.toHaveBeenCalled();
    expect(results[0].status).toBe("suspended");
  });

  // ---------------------------------------------------------------------------
  // Should send 3-day expiry warning notifications
  // ---------------------------------------------------------------------------
  it("should send 3-day expiry warning notifications for subscriptions expiring in 3 days", async () => {
    const now = Date.now();
    const periodEnd = now + THREE_DAYS_MS - 43200000; // ~3 days from now

    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    vi.mocked(getSubscriptionStatus).mockResolvedValue(
      makeSubscriptionStatus({
        organizationId: "org-001",
        status: "active",
        currentPeriodEnd: periodEnd,
      }),
    );
    vi.mocked(transitionSubscriptionStatus).mockResolvedValue({ status: "active" });

    const results = await runBillingValidationCycle(env);

    expect(results[0].warningSent).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Should handle empty organization list gracefully
  // ---------------------------------------------------------------------------
  it("should handle empty organization list gracefully", async () => {
    mockDb.all.mockResolvedValueOnce([]);

    const results = await runBillingValidationCycle(env);

    expect(results).toEqual([]);
    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(transitionSubscriptionStatus).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Should log errors for individual org failures but continue processing
  // ---------------------------------------------------------------------------
  it("should log errors for individual org failures but continue processing", async () => {
    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }, { id: "org-002" }]);
    vi.mocked(getSubscriptionStatus)
      .mockRejectedValueOnce(new Error("DB timeout for org-001"))
      .mockResolvedValueOnce(
        makeSubscriptionStatus({ organizationId: "org-002", status: "active" }),
      );

    const results = await runBillingValidationCycle(env);

    expect(results).toHaveLength(2);
    expect(results[0].organizationId).toBe("org-001");
    expect(results[0].status).toBe("error");
    expect(results[1].organizationId).toBe("org-002");
    expect(results[1].status).toBe("active");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("org-001"),
      expect.any(Error),
    );
  });
});