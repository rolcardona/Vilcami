import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../adapters/wompi-adapter", () => ({
  createPaymentLink: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

function createTestEnv(overrides?: { orgIntegrityKey?: string }): Env {
  const secretsVaultGet = vi.fn().mockResolvedValue(overrides?.orgIntegrityKey ?? null);
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: { get: secretsVaultGet } as unknown as KVNamespace,
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
        id: "txn-001", amountInCents: 850000, currency: "COP",
        status: "APPROVED", paymentMethod: "card",
        reference: "org-001:plan-starter:1700000000000", createdAt: new Date().toISOString(),
      },
    },
    timestamp: new Date().toISOString(),
    signature: { checksum: "abc123", properties: ["transaction.id", "transaction.status"] },
  };
}

describe("Webhook Route — Timestamp Freshness (Finding 6)", () => {
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

  it("rejects webhook with stale timestamp (>5 minutes old)", async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": sixMinutesAgo },
      body: JSON.stringify(createValidWebhookPayload()),
    }, createTestEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Webhook timestamp expired");
    expect(wompiAdapter.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(wompiAdapter.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects webhook with future timestamp (>5 minutes ahead)", async () => {
    const sixMinutesAhead = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": sixMinutesAhead },
      body: JSON.stringify(createValidWebhookPayload()),
    }, createTestEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Webhook timestamp expired");
    expect(wompiAdapter.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("rejects webhook with unparseable timestamp", async () => {
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": "not-a-valid-date" },
      body: JSON.stringify(createValidWebhookPayload()),
    }, createTestEnv());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Webhook timestamp expired");
  });

  it("accepts webhook with timestamp within 5-minute window", async () => {
    (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-transaction-hash": "valid-hash", "timestamp": threeMinutesAgo },
      body: JSON.stringify(createValidWebhookPayload()),
    }, createTestEnv());
    expect(res.status).toBe(200);
    expect(wompiAdapter.handleWebhookEvent).toHaveBeenCalled();
  });
});