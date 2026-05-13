/**
 * Tests for Subscription Service — TDD: written BEFORE implementation.
 *
 * Covers: getSubscriptionStatus, activateSubscription,
 * transitionSubscriptionStatus, checkAndTransitionSubscription, getOrgPlanName.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubscriptionStatus } from "../../types/billing.types";
import type { DrizzleD1Database } from "drizzle-orm/d1";

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
  };
}

let mockDb: ReturnType<typeof createMockDb>;
const db = () => mockDb as unknown as DrizzleD1Database<Record<string, never>>;

vi.mock("../../schema/index", () => ({
  deviceSubscriptions: {
    id: "id", organizationId: "organization_id", deviceId: "device_id",
    planId: "plan_id", status: "status",
    trialStartsAt: "trial_starts_at", trialEndsAt: "trial_ends_at",
    currentPeriodStart: "current_period_start", currentPeriodEnd: "current_period_end",
    addOns: "add_ons", createdAt: "created_at",
  },
  subscriptionPlans: {
    id: "id", name: "name", currencyCode: "currency_code",
    pricePerDeviceCents: "price_per_device_cents", eventsIncluded: "events_included",
    overagePricePerHundredCents: "overage_price_per_hundred_cents",
    features: "features", trialDays: "trial_days",
    maxTrialDevices: "max_trial_devices", isTrialPlan: "is_trial_plan",
  },
  devices: {
    id: "id", organizationId: "organization_id",
  },
}));

vi.mock("../../services/plan-feature.service", () => ({
  getDeviceLimit: vi.fn((planName: string) => {
    const limits: Record<string, number> = {
      trial: 3, starter: 5, professional: 15, enterprise: Infinity,
    };
    return limits[planName] ?? 0;
  }),
  getPlanFeatures: vi.fn(),
}));

import {
  getSubscriptionStatus,
  activateSubscription,
  transitionSubscriptionStatus,
  checkAndTransitionSubscription,
  getOrgPlanName,
} from "../../services/subscription.service";
import { getDeviceLimit } from "../../services/plan-feature.service";
import { NotFoundError } from "../../errors/not-found.error";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = "org-test-001";
const PLAN_ID = "plan-starter-001";
const PAYMENT_ID = "pay-test-001";
const DEVICE_ID = "device-001";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function makeSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-001",
    organizationId: ORG_ID,
    deviceId: DEVICE_ID,
    planId: PLAN_ID,
    status: "trial" as SubscriptionStatus,
    trialStartsAt: new Date("2024-01-01"),
    trialEndsAt: new Date("2024-01-31"),
    currentPeriodStart: null as Date | null,
    currentPeriodEnd: null as Date | null,
    addOns: null as string | null,
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

const PLAN_ROW = {
  id: PLAN_ID,
  name: "Starter",
  currencyCode: "COP",
  pricePerDeviceCents: 8500,
  eventsIncluded: 1000,
  overagePricePerHundredCents: 100,
  features: "[]",
  trialDays: 30,
  maxTrialDevices: 3,
  isTrialPlan: false,
};

describe("subscription.service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb = createMockDb();
  });

  // ---------------------------------------------------------------------------
  // getSubscriptionStatus
  // ---------------------------------------------------------------------------
  describe("getSubscriptionStatus", () => {
    it("returns SubscriptionResponse for an active subscription", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date("2024-02-01"),
        currentPeriodEnd: new Date("2024-03-01"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow); // subscription
      mockDb.get.mockResolvedValueOnce({ name: "Starter" }); // plan name
      mockDb.all.mockResolvedValueOnce([{ count: 2 }]); // device count

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result.organizationId).toBe(ORG_ID);
      expect(result.status).toBe("active");
      expect(result.planName).toBe("starter");
      expect(result.deviceCount).toBe(2);
    });

    it("returns trial subscription with correct limits", async () => {
      const trialRow = makeSubscriptionRow({ status: "trial" });
      mockDb.get.mockResolvedValueOnce(trialRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 1 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result.status).toBe("trial");
      expect(result.maxDevices).toBe(3);
    });

    it("returns suspended subscription with correct status", async () => {
      const suspendedRow = makeSubscriptionRow({
        status: "suspended",
        currentPeriodStart: new Date("2024-01-01"),
        currentPeriodEnd: new Date("2024-02-01"),
      });
      mockDb.get.mockResolvedValueOnce(suspendedRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 5 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result.status).toBe("suspended");
    });

    it("uses currentPeriodEnd directly for active subscriptions (no trialEndsAt fallback)", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date("2024-02-01"),
        currentPeriodEnd: new Date("2024-03-01"),
        trialEndsAt: new Date("2024-01-31"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 2 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      // Must be currentPeriodEnd (March 1), NOT trialEndsAt (Jan 31)
      expect(result!.currentPeriodEnd).toBe(new Date("2024-03-01").getTime());
    });

    it("returns currentPeriodEnd=0 for active subscription with null currentPeriodEnd", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date("2024-02-01"),
        currentPeriodEnd: null,
        trialEndsAt: new Date("2024-01-31"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 2 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      // For non-trial, should return 0, not fall back to trialEndsAt
      expect(result!.currentPeriodEnd).toBe(0);
    });

    it("uses currentPeriodStart directly for active subscriptions (no trialStartsAt fallback)", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date("2024-02-01"),
        currentPeriodEnd: new Date("2024-03-01"),
        trialStartsAt: new Date("2024-01-01"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 2 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      // Must be currentPeriodStart (Feb 1), NOT trialStartsAt (Jan 1)
      expect(result!.currentPeriodStart).toBe(new Date("2024-02-01").getTime());
    });

    it("returns currentPeriodStart=0 for active subscription with null currentPeriodStart", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: null,
        currentPeriodEnd: new Date("2024-03-01"),
        trialStartsAt: new Date("2024-01-01"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 2 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      // For non-trial, should return 0, not fall back to trialStartsAt
      expect(result!.currentPeriodStart).toBe(0);
    });

    it("uses trialStartsAt fallback for trial subscriptions when currentPeriodStart is null", async () => {
      const trialRow = makeSubscriptionRow({
        status: "trial",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialStartsAt: new Date("2024-01-01"),
        trialEndsAt: new Date("2024-01-31"),
      });
      mockDb.get.mockResolvedValueOnce(trialRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 1 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe("trial");
      // For trial, should fall back to trialStartsAt
      expect(result!.currentPeriodStart).toBe(new Date("2024-01-01").getTime());
    });

    it("uses trialEndsAt fallback for trial subscriptions when currentPeriodEnd is null", async () => {
      const trialRow = makeSubscriptionRow({
        status: "trial",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialStartsAt: new Date("2024-01-01"),
        trialEndsAt: new Date("2024-01-31"),
      });
      mockDb.get.mockResolvedValueOnce(trialRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });
      mockDb.all.mockResolvedValueOnce([{ count: 1 }]);

      const result = await getSubscriptionStatus(db(), ORG_ID);

      expect(result).not.toBeNull();
      expect(result!.status).toBe("trial");
      // For trial, should fall back to trialEndsAt
      expect(result!.currentPeriodEnd).toBe(new Date("2024-01-31").getTime());
    });

    it("throws NotFoundError when no subscription found for org", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      try {
        await getSubscriptionStatus(db(), ORG_ID);
        expect.fail("Expected NotFoundError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).resourceType).toBe("Subscription");
        expect((error as NotFoundError).resourceId).toBe(ORG_ID);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // activateSubscription
  // ---------------------------------------------------------------------------
  describe("activateSubscription", () => {
    it("activates a trial subscription (upgrade)", async () => {
      const trialRow = makeSubscriptionRow({ status: "trial" });
      mockDb.get.mockResolvedValueOnce(trialRow);
      mockDb.all.mockResolvedValueOnce([trialRow]);

      const result = await activateSubscription(db(), ORG_ID, PLAN_ID, PAYMENT_ID);

      expect(result.status).toBe("active");
    });

    it("activates a past_due subscription (payment received in grace)", async () => {
      const pastDueRow = makeSubscriptionRow({
        status: "past_due",
        currentPeriodStart: new Date("2024-01-01"),
        currentPeriodEnd: new Date("2024-02-01"),
      });
      mockDb.get.mockResolvedValueOnce(pastDueRow);
      mockDb.all.mockResolvedValueOnce([pastDueRow]);

      const result = await activateSubscription(db(), ORG_ID, PLAN_ID, PAYMENT_ID);

      expect(result.status).toBe("active");
    });

    it("creates a new subscription when none exists", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      const result = await activateSubscription(db(), ORG_ID, PLAN_ID, PAYMENT_ID);

      expect(result.status).toBe("active");
    });

    it("reactivates a cancelled subscription (cancelled → active)", async () => {
      const cancelledRow = makeSubscriptionRow({
        status: "cancelled",
        currentPeriodStart: new Date("2024-01-01"),
        currentPeriodEnd: new Date("2024-02-01"),
      });
      mockDb.get.mockResolvedValueOnce(cancelledRow);
      mockDb.all.mockResolvedValueOnce([cancelledRow]);

      const result = await activateSubscription(db(), ORG_ID, PLAN_ID, PAYMENT_ID);

      expect(result.status).toBe("active");
    });

    it("rejects activation of an already active subscription", async () => {
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date("2024-02-01"),
        currentPeriodEnd: new Date("2024-03-01"),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);

      await expect(
        activateSubscription(db(), ORG_ID, PLAN_ID, PAYMENT_ID),
      ).rejects.toThrow("Invalid subscription transition: active → active");
    });
  });

  // ---------------------------------------------------------------------------
  // transitionSubscriptionStatus — valid transitions
  // ---------------------------------------------------------------------------
  describe("transitionSubscriptionStatus — valid transitions", () => {
    const validTransitions: Array<[SubscriptionStatus, SubscriptionStatus]> = [
      ["trial", "active"],
      ["trial", "suspended"],
      ["active", "past_due"],
      ["past_due", "active"],
      ["past_due", "suspended"],
      ["suspended", "active"],
      ["suspended", "cancelled"],
      ["cancelled", "active"],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows transition: ${from} → ${to}`, async () => {
        const subRow = makeSubscriptionRow({ status: from });
        mockDb.get.mockResolvedValueOnce(subRow);

        const result = await transitionSubscriptionStatus(db(), ORG_ID, to);

        expect(result.status).toBe(to);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // transitionSubscriptionStatus — invalid transitions
  // ---------------------------------------------------------------------------
  describe("transitionSubscriptionStatus — invalid transitions", () => {
    const invalidTransitions: Array<[SubscriptionStatus, SubscriptionStatus]> = [
      ["active", "trial"],
      ["active", "suspended"],
      ["active", "cancelled"],
      ["trial", "past_due"],
      ["trial", "cancelled"],
      ["past_due", "trial"],
      ["past_due", "cancelled"],
      ["cancelled", "trial"],
      ["cancelled", "past_due"],
      ["cancelled", "suspended"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects transition: ${from} → ${to}`, async () => {
        const subRow = makeSubscriptionRow({ status: from });
        mockDb.get.mockResolvedValueOnce(subRow);

        await expect(
          transitionSubscriptionStatus(db(), ORG_ID, to),
        ).rejects.toThrow("Invalid subscription transition");
      });
    }

    it("rejects transition when no subscription exists", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(
        transitionSubscriptionStatus(db(), ORG_ID, "active"),
      ).rejects.toThrow("No subscription found");
    });
  });

  // ---------------------------------------------------------------------------
  // checkAndTransitionSubscription — time-based transitions
  // ---------------------------------------------------------------------------
  describe("checkAndTransitionSubscription", () => {
    it("transitions trial → suspended after 7-day grace period", async () => {
      const now = Date.now();
      const trialStart = now - 42 * 24 * 60 * 60 * 1000; // started 42 days ago
      const trialEnd = now - 8 * 24 * 60 * 60 * 1000; // ended 8 days ago (past grace)
      const trialRow = makeSubscriptionRow({
        status: "trial",
        trialStartsAt: new Date(trialStart),
        trialEndsAt: new Date(trialEnd),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      mockDb.get.mockResolvedValueOnce(trialRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("suspended");
    });

    it("keeps trial status within 7-day grace period after trial end", async () => {
      const now = Date.now();
      const trialStart = now - 37 * 24 * 60 * 60 * 1000;
      const trialEnd = now - 3 * 24 * 60 * 60 * 1000; // ended 3 days ago (within grace)
      const trialRow = makeSubscriptionRow({
        status: "trial",
        trialStartsAt: new Date(trialStart),
        trialEndsAt: new Date(trialEnd),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      mockDb.get.mockResolvedValueOnce(trialRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("trial");
    });

    it("keeps trial status when trial period has NOT ended", async () => {
      const now = Date.now();
      const trialStart = now - 10 * 24 * 60 * 60 * 1000;
      const trialEnd = now + 20 * 24 * 60 * 60 * 1000; // ends in 20 days
      const trialRow = makeSubscriptionRow({
        status: "trial",
        trialStartsAt: new Date(trialStart),
        trialEndsAt: new Date(trialEnd),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      mockDb.get.mockResolvedValueOnce(trialRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("trial");
    });

    it("transitions active → past_due when billing period has ended", async () => {
      const now = Date.now();
      const periodStart = now - 35 * 24 * 60 * 60 * 1000;
      const periodEnd = now - 5 * 24 * 60 * 60 * 1000; // ended 5 days ago
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date(periodStart),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("past_due");
    });

    it("keeps active status when billing period has NOT ended", async () => {
      const now = Date.now();
      const periodStart = now - 10 * 24 * 60 * 60 * 1000;
      const periodEnd = now + 20 * 24 * 60 * 60 * 1000; // ends in 20 days
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date(periodStart),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("active");
    });

    it("transitions past_due → suspended after 7-day grace period", async () => {
      const now = Date.now();
      const periodEnd = now - 8 * 24 * 60 * 60 * 1000; // 8 days past period end
      const pastDueRow = makeSubscriptionRow({
        status: "past_due",
        currentPeriodStart: new Date(periodEnd - THIRTY_DAYS_MS),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(pastDueRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("suspended");
    });

    it("keeps past_due status within 7-day grace period", async () => {
      const now = Date.now();
      const periodEnd = now - 3 * 24 * 60 * 60 * 1000; // 3 days past (within grace)
      const pastDueRow = makeSubscriptionRow({
        status: "past_due",
        currentPeriodStart: new Date(periodEnd - THIRTY_DAYS_MS),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(pastDueRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("past_due");
    });

    it("transitions suspended → cancelled after 30 days of suspension", async () => {
      const now = Date.now();
      const periodEnd = now - 40 * 24 * 60 * 60 * 1000; // period ended 40 days ago
      // 40 days ago = 7 days grace + 33 days suspended → past the 30-day deadline
      const suspendedRow = makeSubscriptionRow({
        status: "suspended",
        currentPeriodStart: new Date(periodEnd - THIRTY_DAYS_MS),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(suspendedRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("cancelled");
    });

    it("keeps suspended status within 30-day cancellation window", async () => {
      const now = Date.now();
      const periodEnd = now - 10 * 24 * 60 * 60 * 1000;
      // 10 days past period end = 3 days past grace, 3 days suspended
      const suspendedRow = makeSubscriptionRow({
        status: "suspended",
        currentPeriodStart: new Date(periodEnd - THIRTY_DAYS_MS),
        currentPeriodEnd: new Date(periodEnd),
      });
      mockDb.get.mockResolvedValueOnce(suspendedRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("suspended");
    });

    it("returns current status when no transition is needed (active, period valid)", async () => {
      const now = Date.now();
      const activeRow = makeSubscriptionRow({
        status: "active",
        currentPeriodStart: new Date(now - THIRTY_DAYS_MS),
        currentPeriodEnd: new Date(now + THIRTY_DAYS_MS),
      });
      mockDb.get.mockResolvedValueOnce(activeRow);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, now);

      expect(result.status).toBe("active");
    });

    it("returns cancelled status when no subscription found", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      const result = await checkAndTransitionSubscription(db(), ORG_ID, Date.now());

      expect(result.status).toBe("cancelled");
    });
  });

  // ---------------------------------------------------------------------------
  // getOrgPlanName
  // ---------------------------------------------------------------------------
  describe("getOrgPlanName", () => {
    it("returns 'trial' for an org in trial status", async () => {
      const subRow = makeSubscriptionRow({ status: "trial" });
      mockDb.get.mockResolvedValueOnce(subRow);

      const planName = await getOrgPlanName(db(), ORG_ID);

      expect(planName).toBe("trial");
    });

    it("returns the plan name for an org with active subscription", async () => {
      const subRow = makeSubscriptionRow({ status: "active" });
      mockDb.get.mockResolvedValueOnce(subRow);
      mockDb.get.mockResolvedValueOnce({ name: "Professional" });

      const planName = await getOrgPlanName(db(), ORG_ID);

      expect(planName).toBe("professional");
    });

    it("returns 'starter' for a Starter plan", async () => {
      const subRow = makeSubscriptionRow({ status: "active" });
      mockDb.get.mockResolvedValueOnce(subRow);
      mockDb.get.mockResolvedValueOnce({ name: "Starter" });

      const planName = await getOrgPlanName(db(), ORG_ID);

      expect(planName).toBe("starter");
    });

    it("throws when no subscription found", async () => {
      mockDb.get.mockResolvedValueOnce(null);

      await expect(getOrgPlanName(db(), ORG_ID))
        .rejects.toThrow("No subscription found");
    });
  });
});