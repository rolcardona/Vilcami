/**
 * Wompi Adapter — Amount verification tests (Findings 2, 15)
 * Tests that handleWebhookEvent:
 *   - Verifies amount against KV checkout record
 *   - Rejects mismatched amounts (price manipulation)
 *   - Rejects missing checkout records (tampering)
 *   - Includes planId in payment records
 *   - Verifies organizationId matches checkout record
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue(null), // no existing event (idempotency check)
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(),
      })),
    })),
  })),
}));

vi.mock("../../services/subscription.service", () => ({
  activateSubscription: vi.fn().mockResolvedValue({ status: "active" }),
}));

import { handleWebhookEvent } from "../../adapters/wompi-adapter";
import type { WompiWebhookPayload } from "../../types/wompi";
import type { Env } from "../../types/env";

function createTestEnv(secretsVaultOverrides: Record<string, string> = {}): Env {
  const store = { ...secretsVaultOverrides };
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn((key: string) => store[key] ?? null),
      put: vi.fn((key: string, value: string) => { store[key] = value; return Promise.resolve(); }),
      delete: vi.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
    } as unknown as KVNamespace,
    THROTTLE_KV: {} as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
    FRONTEND_URL: "http://localhost:5173",
  };
}

function createApprovedPayload(amountInCents: number, reference: string): WompiWebhookPayload {
  return {
    event: "transaction.approved",
    data: {
      transaction: {
        id: "txn-" + Math.random().toString(36).slice(2, 8),
        amountInCents,
        currency: "COP",
        status: "APPROVED",
        paymentMethod: "card",
        reference,
        createdAt: "2026-05-12T10:00:00Z",
      },
    },
    timestamp: "2026-05-12T10:00:00Z",
    signature: { checksum: "abc123", properties: ["transaction.id", "transaction.status"] },
  };
}

describe("Wompi Adapter — Amount Verification (Findings 2, 15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes approved event when amount matches checkout record", async () => {
    const env = createTestEnv({
      "checkout:org-001:plan-starter:1747000000000": JSON.stringify({
        amountInCents: 2550000,
        planId: "plan-starter",
        orgId: "org-001",
      }),
    });

    const payload = createApprovedPayload(2550000, "org-001:plan-starter:1747000000000");
    const result = await handleWebhookEvent(env, "org-001", payload);
    expect(result.processed).toBe(true);
  });

  it("rejects event when Wompi amount does not match checkout amount", async () => {
    const env = createTestEnv({
      "checkout:org-001:plan-starter:1747000000000": JSON.stringify({
        amountInCents: 2550000,
        planId: "plan-starter",
        orgId: "org-001",
      }),
    });

    // Attacker sends a payload with a different (lower) amount
    const payload = createApprovedPayload(100000, "org-001:plan-starter:1747000000000");
    await expect(handleWebhookEvent(env, "org-001", payload)).rejects.toThrow(/amount mismatch/i);
  });

  it("rejects event when no checkout record exists in KV (tampered or expired)", async () => {
    const env = createTestEnv(); // no checkout data stored

    const payload = createApprovedPayload(2550000, "org-001:plan-starter:1747000000000");
    await expect(handleWebhookEvent(env, "org-001", payload)).rejects.toThrow(/no checkout record/i);
  });

  it("rejects event when organizationId does not match checkout record", async () => {
    const env = createTestEnv({
      "checkout:org-001:plan-starter:1747000000000": JSON.stringify({
        amountInCents: 2550000,
        planId: "plan-starter",
        orgId: "org-001",
      }),
    });

    // Attacker sends a payload targeting a different org
    const payload = createApprovedPayload(2550000, "org-001:plan-starter:1747000000000");
    await expect(handleWebhookEvent(env, "org-002", payload)).rejects.toThrow(/organization mismatch/i);
  });

  it("deletes checkout record from KV after processing (one-time use)", async () => {
    const env = createTestEnv({
      "checkout:org-001:plan-starter:1747000000000": JSON.stringify({
        amountInCents: 2550000,
        planId: "plan-starter",
        orgId: "org-001",
      }),
    });

    const payload = createApprovedPayload(2550000, "org-001:plan-starter:1747000000000");
    await handleWebhookEvent(env, "org-001", payload);

    expect(env.SECRETS_VAULT.delete).toHaveBeenCalledWith(
      "checkout:org-001:plan-starter:1747000000000",
    );
  });

  it("includes planId from reference in payment record", async () => {
    const { getDrizzleDb } = await import("../../utils/db.util");
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn().mockResolvedValue(null),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    };
    (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);

    const env = createTestEnv({
      "checkout:org-001:plan-starter:1747000000000": JSON.stringify({
        amountInCents: 2550000,
        planId: "plan-starter",
        orgId: "org-001",
      }),
    });

    const payload = createApprovedPayload(2550000, "org-001:plan-starter:1747000000000");
    await handleWebhookEvent(env, "org-001", payload);

    // Verify that insert was called with planId
    // insert is called twice: first for wompiEvents (idempotency), then for payments
    const insertCalls = mockDb.insert.mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    // The second insert is the payments insert
    const valuesCall = mockDb.insert.mock.results[1].value.values.mock.calls[0][0];
    expect(valuesCall.planId).toBe("plan-starter");
  });
});