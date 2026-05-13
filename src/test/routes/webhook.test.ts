import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../adapters/wompi-adapter", () => ({
  createPaymentLink: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

function createTestEnv(overrides?: { orgIntegrityKey?: string | null }): Env {
  // Per-org integrity key: if null is passed, simulate KV miss (returns null → fallback).
  // If a string is passed, simulate KV hit (returns that string).
  // Default: simulate KV miss so it falls back to env.WOMPI_EVENT_INTEGRITY_KEY.
  const orgIntegrityKey = overrides?.orgIntegrityKey;

  const secretsVaultGet = vi.fn().mockImplementation((key: string) => {
    // Match per-org integrity key pattern: {orgId}:secret:wompi_event_integrity_key
    if (key.endsWith(":secret:wompi_event_integrity_key")) {
      return Promise.resolve(orgIntegrityKey !== undefined ? orgIntegrityKey : null);
    }
    return Promise.resolve(null);
  });

  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: secretsVaultGet,
    } as unknown as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    THROTTLE_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
    FRONTEND_URL: "http://localhost:5173",
  };
}

function createValidWebhookPayload() {
  return {
    event: "transaction.approved",
    data: {
      transaction: {
        id: "txn-001",
        amountInCents: 850000,
        currency: "COP",
        status: "APPROVED",
        paymentMethod: "card",
        reference: "org-001:plan-starter:1700000000000",
        createdAt: new Date().toISOString(),
      },
    },
    timestamp: new Date().toISOString(),
    signature: { checksum: "abc123", properties: ["transaction.id", "transaction.status"] },
  };
}

describe("Webhook Route", () => {
  let webhookRoutesModule: { webhookRoutes: Hono<{ Bindings: Env }> };
  let wompiAdapter: typeof import("../../adapters/wompi-adapter");

  beforeEach(async () => {
    vi.clearAllMocks();
    wompiAdapter = await import("../../adapters/wompi-adapter");
    webhookRoutesModule = await import("../../routes/webhook.routes");
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function mountApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/webhooks", webhookRoutesModule.webhookRoutes);
    return app;
  }

  describe("POST /api/webhooks/wompi — basic validation", () => {
    it("processes event with valid signature and fresh timestamp", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(createValidWebhookPayload()),
      }, createTestEnv());
      expect(res.status).toBe(200);
      expect(((await res.json()) as { processed: boolean }).processed).toBe(true);
    });

    it("returns 400 for invalid signature", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "invalid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(createValidWebhookPayload()),
      }, createTestEnv());
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_signature");
    });

    it("returns 400 for missing x-transaction-hash header", async () => {
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "timestamp": new Date().toISOString() },
        body: JSON.stringify(createValidWebhookPayload()),
      }, createTestEnv());
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/missing/i);
    });

    it("returns 400 for missing timestamp header", async () => {
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "some-hash" },
        body: JSON.stringify(createValidWebhookPayload()),
      }, createTestEnv());
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/missing/i);
    });

    it("handles duplicate event idempotently", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true });
      const payload = createValidWebhookPayload();
      const opts = {
        method: "POST" as const,
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(payload),
      };
      const res1 = await mountApp().request("/api/webhooks/wompi", opts, createTestEnv());
      expect(res1.status).toBe(200);
      const res2 = await mountApp().request("/api/webhooks/wompi", {
        ...opts,
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
      }, createTestEnv());
      expect(res2.status).toBe(200);
      expect(((await res2.json()) as { processed: boolean }).processed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Per-organization Wompi integrity key resolution
  // -------------------------------------------------------------------------
  describe("POST /api/webhooks/wompi — per-org integrity key resolution", () => {
    it("uses per-organization integrity key from KV Vault when available", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });

      // Provide a per-org key — should be used instead of env.WOMPI_EVENT_INTEGRITY_KEY
      const env = createTestEnv({ orgIntegrityKey: "org-specific-integrity-key" });
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(createValidWebhookPayload()),
      }, env);

      expect(res.status).toBe(200);
      // Verify verifyWebhookSignature was called with the per-org key
      const signCallArgs = (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(signCallArgs[0]).toBe("org-specific-integrity-key");
    });

    it("falls back to env.WOMPI_EVENT_INTEGRITY_KEY when per-org key is not in KV Vault", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });

      // Default createTestEnv returns null for per-org key → falls back to env var
      const env = createTestEnv();
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(createValidWebhookPayload()),
      }, env);

      expect(res.status).toBe(200);
      // Verify verifyWebhookSignature was called with the fallback env key
      const signCallArgs = (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(signCallArgs[0]).toBe("test-integrity-key");
    });

    it("returns 400 when reference has no extractable orgId", async () => {
      const payloadWithoutOrgId = {
        event: "transaction.approved",
        data: {
          transaction: {
            id: "txn-002",
            amountInCents: 850000,
            currency: "COP",
            status: "APPROVED",
            paymentMethod: "card",
            reference: "", // empty reference → no orgId
            createdAt: new Date().toISOString(),
          },
        },
        timestamp: new Date().toISOString(),
        signature: { checksum: "abc123", properties: ["transaction.id", "transaction.status"] },
      };

      const env = createTestEnv();
      const res = await mountApp().request("/api/webhooks/wompi", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": new Date().toISOString() },
        body: JSON.stringify(payloadWithoutOrgId),
      }, env);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/cannot determine organization/i);
    });
  });
});