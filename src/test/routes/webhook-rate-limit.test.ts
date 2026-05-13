/**
 * Tests for Webhook Route — Per-IP Rate Limiting (Finding #19).
 * TDD: written BEFORE implementation.
 *
 * Covers: rate limit enforcement per IP via THROTTLE_KV,
 * 429 response when limit exceeded, cf-connecting-ip header usage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../adapters/wompi-adapter", () => ({
  createPaymentLink: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

/** Creates a test Env with a mock THROTTLE_KV that tracks call counts */
function createTestEnvWithThrottle(): {
  env: Env;
  throttleStore: Map<string, string>;
  throttlePutCalls: Array<{ key: string; value: string }>;
} {
  const throttleStore = new Map<string, string>();
  const throttlePutCalls: Array<{ key: string; value: string }> = [];

  const throttleKvGet = vi.fn().mockImplementation((key: string) => {
    return Promise.resolve(throttleStore.get(key) ?? null);
  });
  const throttleKvPut = vi.fn().mockImplementation((key: string, value: string, options?: { expirationTtl?: number }) => {
    throttleStore.set(key, value);
    throttlePutCalls.push({ key, value });
    return Promise.resolve();
  });

  const secretsVaultGet = vi.fn().mockResolvedValue(null);

  const env: Env = {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: secretsVaultGet,
    } as unknown as KVNamespace,
    THROTTLE_KV: {
      get: throttleKvGet,
      put: throttleKvPut,
    } as unknown as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
  };

  return { env, throttleStore, throttlePutCalls };
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

describe("Webhook Route — Per-IP Rate Limiting (Finding #19)", () => {
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

  it("allows webhook requests under the rate limit", async () => {
    (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ processed: true });

    const { env } = createTestEnvWithThrottle();
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        "cf-connecting-ip": "203.0.113.1",
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { processed: boolean }).processed).toBe(true);
  });

  it("returns 429 when IP exceeds 60 requests per minute", async () => {
    const { env, throttleStore } = createTestEnvWithThrottle();

    // Pre-fill the throttle counter to the limit (60 requests already made)
    const now = new Date();
    const minuteBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    const rateLimitKey = `webhook-rate:203.0.113.1:${minuteBucket}`;
    throttleStore.set(rateLimitKey, "60");

    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        "cf-connecting-ip": "203.0.113.1",
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate_limit/i);
    // Verify HMAC verification was NOT called (rate limit comes first)
    expect(wompiAdapter.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("does not rate-limit different IPs independently", async () => {
    (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true });

    const { env, throttleStore } = createTestEnvWithThrottle();

    // Fill rate limit for IP 203.0.113.1
    const now = new Date();
    const minuteBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    throttleStore.set(`webhook-rate:203.0.113.1:${minuteBucket}`, "60");

    // IP 198.51.100.2 should still be allowed
    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        "cf-connecting-ip": "198.51.100.2",
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    expect(res.status).toBe(200);
    expect(wompiAdapter.verifyWebhookSignature).toHaveBeenCalled();
  });

  it("increments the throttle counter on each allowed request", async () => {
    (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true });

    const { env, throttlePutCalls } = createTestEnvWithThrottle();

    // Make first request
    await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        "cf-connecting-ip": "203.0.113.5",
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    // The THROTTLE_KV.put should have been called for rate limiting
    const rateLimitPuts = throttlePutCalls.filter((call) => call.key.startsWith("webhook-rate:203.0.113.5"));
    expect(rateLimitPuts.length).toBeGreaterThanOrEqual(1);
    expect(rateLimitPuts[0].value).toBe("1");
  });

  it("falls back to 'unknown' IP when cf-connecting-ip header is missing", async () => {
    (wompiAdapter.verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (wompiAdapter.handleWebhookEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ processed: true });

    const { env } = createTestEnvWithThrottle();

    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        // No cf-connecting-ip header
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    expect(res.status).toBe(200);
  });

  it("rate-limits before HMAC verification — CPU-intensive check is skipped on 429", async () => {
    const { env, throttleStore } = createTestEnvWithThrottle();

    // Fill rate limit for the IP
    const now = new Date();
    const minuteBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    throttleStore.set(`webhook-rate:203.0.113.99:${minuteBucket}`, "60");

    const res = await mountApp().request("/api/webhooks/wompi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-transaction-hash": "valid-hash",
        "timestamp": new Date().toISOString(),
        "cf-connecting-ip": "203.0.113.99",
      },
      body: JSON.stringify(createValidWebhookPayload()),
    }, env);

    expect(res.status).toBe(429);
    // CRITICAL: verifyWebhookSignature must NOT have been called
    // Rate limit must short-circuit BEFORE the CPU-intensive HMAC verification
    expect(wompiAdapter.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(wompiAdapter.handleWebhookEvent).not.toHaveBeenCalled();
  });
});