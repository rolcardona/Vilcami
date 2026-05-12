import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../services/subscription.service", () => ({
  getSubscriptionStatus: vi.fn(),
  activateSubscription: vi.fn(),
}));

vi.mock("../../adapters/wompi-adapter", () => ({
  createPaymentLink: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));

vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(),
            all: vi.fn(),
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

async function generateTestKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

async function createSignedJwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid: string = "test-key-id",
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid };
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signInput = `${headerB64}.${payloadB64}`;
  const signData = new TextEncoder().encode(signInput);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signData);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

let testPrivateKey: CryptoKey;
let testPublicKeyJwk: JsonWebKey;
let originalFetch: typeof globalThis.fetch;

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({ keys: [testPublicKeyJwk], cachedAt: Date.now() }),
      ),
      put: vi.fn().mockResolvedValue(undefined),
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

describe("Billing Routes", () => {
  let billingRoutesModule: { billingRoutes: Hono<{ Bindings: Env }> };
  let subService: typeof import("../../services/subscription.service");
  let wompiAdapter: typeof import("../../adapters/wompi-adapter");

  beforeAll(async () => {
    const keyPair = await generateTestKeyPair();
    testPrivateKey = keyPair.privateKey;
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    testPublicKeyJwk = { ...exported, kid: "test-key-id", alg: "RS256" } as unknown as JsonWebKey;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [testPublicKeyJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    subService = await import("../../services/subscription.service");
    wompiAdapter = await import("../../adapters/wompi-adapter");
    billingRoutesModule = await import("../../routes/billing.routes");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mountApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/billing", billingRoutesModule.billingRoutes);
    return app;
  }

  async function createAuthHeaders(overrides: Record<string, unknown> = {}): Promise<Record<string, string>> {
    const mfa = overrides.mfa_verified ?? false;
    const claims: Record<string, unknown> = {
      sub: overrides.sub ?? "user-001",
      org_id: overrides.org_id ?? "org-001",
      role: overrides.role ?? "user",
      aal: mfa ? "aal2" : "aal1",
      iss: overrides.iss ?? "https://test-project.supabase.co",
      exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
      iat: overrides.iat ?? Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(claims, testPrivateKey);
    return { Authorization: `Bearer ${token}` };
  }

  // -------------------------------------------------------------------------
  // Auth guards
  // -------------------------------------------------------------------------
  describe("auth guards", () => {
    it("returns 401 for missing Authorization header", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const res = await app.request("/api/billing/subscription", undefined, env);
      expect(res.status).toBe(401);
    });

    it("returns 403 for admin without MFA", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: false });
      const res = await app.request("/api/billing/subscription", { headers }, env);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // POST /checkout
  // -------------------------------------------------------------------------
  describe("POST /api/billing/checkout", () => {
    it("creates a payment link successfully", async () => {
      (wompiAdapter.createPaymentLink as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: "pl-001",
        url: "https://checkout.wompi.co/pay/pl-001",
        reference: "ref-001",
        expiresAt: "2026-06-01T00:00:00Z",
      });

      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/billing/checkout", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "plan-starter", deviceCount: 3, returnUrl: "https://app.vilcami.co/billing" }),
      }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string; reference: string; expiresAt: string };
      expect(body.url).toBe("https://checkout.wompi.co/pay/pl-001");
      expect(body.reference).toBe("ref-001");
    });

    it("returns 400 for invalid plan in checkout request", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/billing/checkout", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "", deviceCount: 3, returnUrl: "https://app.vilcami.co/billing" }),
      }, env);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/validation/i);
    });

    it("returns 400 for invalid deviceCount", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/billing/checkout", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "plan-starter", deviceCount: -1, returnUrl: "https://app.vilcami.co/billing" }),
      }, env);

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /subscription
  // -------------------------------------------------------------------------
  describe("GET /api/billing/subscription", () => {
    it("returns subscription status for authenticated org", async () => {
      (subService.getSubscriptionStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        organizationId: "org-001",
        planName: "starter",
        status: "active",
        currentPeriodStart: 1700000000000,
        currentPeriodEnd: 1735689600000,
        deviceCount: 3,
        maxDevices: 5,
      });

      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/billing/subscription", { headers }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { planName: string; status: string };
      expect(body.planName).toBe("starter");
      expect(body.status).toBe("active");
    });
  });

  // -------------------------------------------------------------------------
  // GET /plans
  // -------------------------------------------------------------------------
  describe("GET /api/billing/plans", () => {
    it("returns all plan features with pricing", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders();
      const res = await app.request("/api/billing/plans", { headers }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { plans: Record<string, unknown>[] };
      expect(body.plans).toBeDefined();
      const planNames = body.plans.map((p: Record<string, unknown>) => p.name);
      expect(planNames).toContain("trial");
      expect(planNames).toContain("starter");
      expect(planNames).toContain("professional");
      expect(planNames).toContain("enterprise");
    });
  });

  // -------------------------------------------------------------------------
  // GET /payments
  // -------------------------------------------------------------------------
  describe("GET /api/billing/payments", () => {
    /** Creates a mock Drizzle DB that handles two chained query calls:
     *  1st call: select().from().where().limit().offset().all() → payment records
     *  2nd call: select({count}).from().where().get() → total count
     */
    function createPaymentsMockDb(paymentRecords: unknown[], totalCount: number) {
      let callIndex = 0;
      const selectFn = vi.fn(() => {
        callIndex++;
        if (callIndex === 1) {
          // First query: select payments with pagination
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(() => ({
                  offset: vi.fn(() => ({
                    all: vi.fn().mockResolvedValueOnce(paymentRecords),
                  })),
                })),
              })),
            })),
          };
        }
        // Second query: select count
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              get: vi.fn().mockResolvedValueOnce({ count: totalCount }),
            })),
          })),
        };
      });
      return { select: selectFn };
    }

    it("returns paginated payment history", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders();

      const mockDb = createPaymentsMockDb(
        [{ id: "pay-001", organizationId: "org-001", amountInCents: 850000, currency: "COP", status: "completed", createdAt: 1700000000 }],
        1,
      );
      const { getDrizzleDb } = await import("../../utils/db.util");
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockDb);

      const res = await app.request("/api/billing/payments?limit=10&offset=0", { headers }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { payments: unknown[]; total: number };
      expect(Array.isArray(body.payments)).toBe(true);
      expect(body.total).toBe(1);
    });

    it("respects limit and offset query parameters", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders();

      const mockDb = createPaymentsMockDb([], 0);
      const { getDrizzleDb } = await import("../../utils/db.util");
      (getDrizzleDb as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockDb);

      const res = await app.request("/api/billing/payments?limit=5&offset=10", { headers }, env);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { limit: number; offset: number };
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
    });
  });
});