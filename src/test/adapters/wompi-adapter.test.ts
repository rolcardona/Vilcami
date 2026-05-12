import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleWebhookEvent } from "../../adapters/wompi-adapter";
import type { Env } from "../../types/env";
import type { WompiWebhookPayload } from "../../types/wompi";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(),
          })),
        })),
      })),
    })),
  })),
}));

vi.mock("../../services/subscription.service", () => ({
  activateSubscription: vi.fn(),
}));

vi.mock("../../schema/index", () => ({
  payments: {
    id: "id",
    organizationId: "organization_id",
    wompiTransactionId: "wompi_transaction_id",
    amountInCents: "amount_in_cents",
    currency: "currency",
    status: "status",
    paymentMethod: "payment_method",
    wompiReference: "wompi_reference",
    planId: "plan_id",
    deviceCount: "device_count",
    billingPeriodStart: "billing_period_start",
    billingPeriodEnd: "billing_period_end",
  },
  wompiEvents: {
    id: "id",
    organizationId: "organization_id",
    wompiEventId: "wompi_event_id",
    eventType: "event_type",
    payload: "payload",
    processedAt: "processed_at",
  },
}));

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    THROTTLE_KV: {} as KVNamespace,
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

function createApprovedPayload(): WompiWebhookPayload {
  return {
    event: "transaction.approved",
    data: {
      transaction: {
        id: "txn-001",
        amountInCents: 850000,
        currency: "COP",
        status: "APPROVED",
        paymentMethod: "card",
        reference: "org-001:plan-starter:1700000000",
        createdAt: new Date().toISOString(),
      },
    },
    timestamp: new Date().toISOString(),
    signature: { checksum: "abc123", properties: ["transaction.id"] },
  };
}

describe("Wompi Adapter — handleWebhookEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Atomic idempotency (Finding 10 — TOCTOU race condition fix)
  // -----------------------------------------------------------------------
  describe("atomic idempotency via INSERT-first", () => {
    it("returns { processed: true } when unique constraint violation is detected", async () => {
      // Simulate a unique constraint violation on INSERT
      const { getDrizzleDb } = await import("../../utils/db.util");
      const insertRunMock = vi.fn().mockRejectedValue(
        new Error("D1_ERROR: UNIQUE constraint failed: wompi_events.wompi_event_id (2067)"),
      );
      const insertValuesMock = vi.fn(() => ({ run: insertRunMock }));
      const insertMock = vi.fn(() => ({ values: insertValuesMock }));
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        insert: insertMock,
      });

      const env = createTestEnv();
      const payload = createApprovedPayload();

      const result = await handleWebhookEvent(env, "org-001", payload);
      expect(result.processed).toBe(true);
    });

    it("re-throws non-unique-constraint errors from INSERT", async () => {
      // Simulate a non-unique constraint error (e.g., foreign key violation)
      const { getDrizzleDb } = await import("../../utils/db.util");
      const insertRunMock = vi.fn().mockRejectedValue(
        new Error("D1_ERROR: Some other database error"),
      );
      const insertValuesMock = vi.fn(() => ({ run: insertRunMock }));
      const insertMock = vi.fn(() => ({ values: insertValuesMock }));
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        insert: insertMock,
      });

      const env = createTestEnv();
      const payload = createApprovedPayload();

      await expect(handleWebhookEvent(env, "org-001", payload)).rejects.toThrow(
        "Some other database error",
      );
    });

    it("detects unique constraint violation with 'UNIQUE constraint failed' message", async () => {
      const { getDrizzleDb } = await import("../../utils/db.util");
      const insertRunMock = vi.fn().mockRejectedValue(
        new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: wompi_events.wompi_event_id"),
      );
      const insertValuesMock = vi.fn(() => ({ run: insertRunMock }));
      const insertMock = vi.fn(() => ({ values: insertValuesMock }));
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        insert: insertMock,
      });

      const env = createTestEnv();
      const payload = createApprovedPayload();

      const result = await handleWebhookEvent(env, "org-001", payload);
      expect(result.processed).toBe(true);
    });

    it("detects unique constraint violation with 'unique constraint violation' message", async () => {
      const { getDrizzleDb } = await import("../../utils/db.util");
      const insertRunMock = vi.fn().mockRejectedValue(
        new Error("unique constraint violation on wompi_event_id"),
      );
      const insertValuesMock = vi.fn(() => ({ run: insertRunMock }));
      const insertMock = vi.fn(() => ({ values: insertValuesMock }));
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        insert: insertMock,
      });

      const env = createTestEnv();
      const payload = createApprovedPayload();

      const result = await handleWebhookEvent(env, "org-001", payload);
      expect(result.processed).toBe(true);
    });

    it("detects D1 error code 2067 for unique constraint", async () => {
      const { getDrizzleDb } = await import("../../utils/db.util");
      const insertRunMock = vi.fn().mockRejectedValue(
        new Error("D1_ERROR code 2067: constraint violation"),
      );
      const insertValuesMock = vi.fn(() => ({ run: insertRunMock }));
      const insertMock = vi.fn(() => ({ values: insertValuesMock }));
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        insert: insertMock,
      });

      const env = createTestEnv();
      const payload = createApprovedPayload();

      const result = await handleWebhookEvent(env, "org-001", payload);
      expect(result.processed).toBe(true);
    });
  });
});