import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../adapters/wompi-adapter", () => ({
  createPaymentLink: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {} as KVNamespace,
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
        reference: "ref-001",
        createdAt: "2026-05-11T10:00:00Z",
      },
    },
    timestamp: "2026-05-11T10:00:00Z",
    signature: {
      checksum: "abc123",
      properties: ["transaction.id", "transaction.status"],
    },
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mountApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/webhooks", webhookRoutesModule.webhookRoutes);
    return app;
  }

  // -------------------------------------------------------------------------
  // POST /wompi
  // -------------------------------------------------------------------------
  describe("POST /api/webhooks/wompi", () => {
    it("processes event with valid signature", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });

      const app = mountApp();
      const env = createTestEnv();
      const payload = createValidWebhookPayload();
      const res = await app.request("/api/webhooks/wompi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-transaction-hash": "valid-hash",
          "timestamp": "2026-05-11T10:00:00Z",
        },
        body: JSON.stringify(payload),
      }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { processed: boolean };
      expect(body.processed).toBe(true);
      expect(wompiAdapter.verifyWebhookSignature).toHaveBeenCalled();
      expect(wompiAdapter.handleWebhookEvent).toHaveBeenCalled();
    });

    it("returns 400 for invalid signature", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const app = mountApp();
      const env = createTestEnv();
      const payload = createValidWebhookPayload();
      const res = await app.request("/api/webhooks/wompi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-transaction-hash": "invalid-hash",
          "timestamp": "2026-05-11T10:00:00Z",
        },
        body: JSON.stringify(payload),
      }, env);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_signature");
      expect(wompiAdapter.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it("returns 400 for missing x-transaction-hash header", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const payload = createValidWebhookPayload();
      const res = await app.request("/api/webhooks/wompi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "timestamp": "2026-05-11T10:00:00Z",
        },
        body: JSON.stringify(payload),
      }, env);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/missing/i);
    });

    it("returns 400 for missing timestamp header", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const payload = createValidWebhookPayload();
      const res = await app.request("/api/webhooks/wompi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-transaction-hash": "some-hash",
        },
        body: JSON.stringify(payload),
      }, env);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/missing/i);
    });

    it("handles duplicate event idempotently", async () => {
      (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true });

      const app = mountApp();
      const env = createTestEnv();
      const payload = createValidWebhookPayload();
      const requestOpts = {
        method: "POST" as const,
        headers: {
          "Content-Type": "application/json",
          "x-transaction-hash": "valid-hash",
          "timestamp": "2026-05-11T10:00:00Z",
        },
        body: JSON.stringify(payload),
      };

      // First request
      const res1 = await app.request("/api/webhooks/wompi", requestOpts, env);
      expect(res1.status).toBe(200);

      // Duplicate request (same event)
      const res2 = await app.request("/api/webhooks/wompi", requestOpts, env);
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { processed: boolean };
      expect(body2.processed).toBe(true);
    });
  });
});