import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  getAlertById: vi.fn(),
  acknowledgeAlert: vi.fn(),
  resolveAlert: vi.fn(),
  shelveAlert: vi.fn(),
  getActiveAlertCountsBySeverity: vi.fn(),
  createPushSubscription: vi.fn(),
}));

vi.mock("../../services/alert-management.service", () => mocks);

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
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

async function createAuthHeaders(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, string>> {
  const mfa = overrides.mfa_verified ?? false;
  const claims: Record<string, unknown> = {
    sub: overrides.sub ?? "user-001",
    org_id: overrides.org_id === undefined ? "org-001" : overrides.org_id,
    role: overrides.role ?? "user",
    aal: mfa ? "aal2" : "aal1",
    iss: overrides.iss ?? "https://test-project.supabase.co",
    exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
    iat: overrides.iat ?? Math.floor(Date.now() / 1000),
  };
  const token = await createSignedJwt(claims, testPrivateKey);
  return { Authorization: `Bearer ${token}` };
}

const sampleAlert = {
  id: "alert-001",
  organizationId: "org-001",
  deviceId: "dev-001",
  sensorType: "temperature",
  severity: "critical",
  ruleType: "critical_threshold",
  currentValue: "12.5",
  thresholdValue: "8.0",
  aiMessage: "Temperature exceeds threshold",
  aiContext: JSON.stringify({ delta: 4.5, trend: "rising" }),
  channels: JSON.stringify(["whatsapp", "push"]),
  acknowledgedAt: null,
  resolvedAt: null,
  createdAt: 1700000000,
  updatedAt: 1700000000,
};

describe("Alert Routes", () => {
  let alertRoutesModule: { alertRoutes: Hono<{ Bindings: Env }>; pushSubscriptionRoutes: Hono<{ Bindings: Env }> };

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
    alertRoutesModule = await import("../../routes/alerts.routes");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mountApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/alerts", alertRoutesModule.alertRoutes);
    app.route("/api/push-subscriptions", alertRoutesModule.pushSubscriptionRoutes);
    return app;
  }

  // --- Auth guards ---
  it("returns 401 for missing Authorization header on GET /api/alerts", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const res = await app.request("/api/alerts", undefined, env);
    expect(res.status).toBe(401);
  });

  it("returns 403 for admin without MFA on GET /api/alerts", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: false });
    const res = await app.request("/api/alerts", { headers }, env);
    expect(res.status).toBe(403);
  });

  // --- GET /api/alerts (list) ---
  it("GET /api/alerts returns paginated list", async () => {
    mocks.listAlerts.mockResolvedValue({
      alerts: [sampleAlert], total: 1, page: 1, limit: 20,
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts", { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { alerts: unknown[]; total: number; page: number };
    expect(body.alerts).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(mocks.listAlerts).toHaveBeenCalledWith(env, "org-001", { page: 1, limit: 20 });
  });

  it("GET /api/alerts passes query filters to service", async () => {
    mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, page: 1, limit: 10 });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts?page=1&limit=10&severity=p0&status=active&deviceId=dev-001", { headers }, env);
    expect(res.status).toBe(200);
    expect(mocks.listAlerts).toHaveBeenCalledWith(env, "org-001", {
      page: 1, limit: 10, severity: "p0", status: "active", deviceId: "dev-001",
    });
  });

  it("GET /api/alerts returns 400 for invalid query params", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts?page=-1", { headers }, env);
    expect(res.status).toBe(400);
  });

  // --- GET /api/alerts/active/count ---
  it("GET /api/alerts/active/count returns severity counts", async () => {
    mocks.getActiveAlertCountsBySeverity.mockResolvedValue({
      counts: { critical: 2, high: 5, medium: 1 },
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts/active/count", { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { counts: Record<string, number> };
    expect(body.counts.critical).toBe(2);
    expect(mocks.getActiveAlertCountsBySeverity).toHaveBeenCalledWith(env, "org-001");
  });

  // --- GET /api/alerts/:alertId ---
  it("GET /api/alerts/:alertId returns alert with parsed aiContext", async () => {
    mocks.getAlertById.mockResolvedValue({ alert: { ...sampleAlert } });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts/alert-001", { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { alert: Record<string, unknown> };
    expect(body.alert.id).toBe("alert-001");
    expect(body.alert.aiContext).toEqual({ delta: 4.5, trend: "rising" });
    expect(mocks.getAlertById).toHaveBeenCalledWith(env, "alert-001", "org-001");
  });

  it("GET /api/alerts/:alertId returns 404 for non-existent alert", async () => {
    mocks.getAlertById.mockResolvedValue({ alert: null });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/alerts/alert-gone", { headers }, env);
    expect(res.status).toBe(404);
  });

  // --- PATCH /api/alerts/:alertId/acknowledge ---
  it("PATCH /api/alerts/:alertId/acknowledge acknowledges alert", async () => {
    mocks.acknowledgeAlert.mockResolvedValue({
      success: true, alert: { ...sampleAlert, acknowledgedAt: Math.floor(Date.now() / 1000) },
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-001/acknowledge", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgmentNotes: "Investigating" }),
    }, env);
    expect(res.status).toBe(200);
    expect(mocks.acknowledgeAlert).toHaveBeenCalledWith(env, "alert-001", "org-001", "user-001", "Investigating");
  });

  it("PATCH /api/alerts/:alertId/acknowledge returns 400 for invalid body", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-001/acknowledge", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ unexpectedField: "bad" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("PATCH /api/alerts/:alertId/acknowledge returns 404 for missing alert", async () => {
    mocks.acknowledgeAlert.mockResolvedValue({ success: false, error: "Alert not found" });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-gone/acknowledge", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, env);
    expect(res.status).toBe(404);
  });

  // --- PATCH /api/alerts/:alertId/resolve ---
  it("PATCH /api/alerts/:alertId/resolve resolves alert", async () => {
    mocks.resolveAlert.mockResolvedValue({
      success: true, alert: { ...sampleAlert, resolvedAt: Math.floor(Date.now() / 1000) },
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-001/resolve", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionNotes: "Fixed" }),
    }, env);
    expect(res.status).toBe(200);
    expect(mocks.resolveAlert).toHaveBeenCalledWith(env, "alert-001", "org-001", "user-001", "Fixed");
  });

  it("PATCH /api/alerts/:alertId/resolve returns 404 for missing alert", async () => {
    mocks.resolveAlert.mockResolvedValue({ success: false, error: "Alert not found" });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-gone/resolve", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, env);
    expect(res.status).toBe(404);
  });

  // --- POST /api/alerts/:alertId/shelve ---
  it("POST /api/alerts/:alertId/shelve shelves alert", async () => {
    mocks.shelveAlert.mockResolvedValue({
      success: true, alert: sampleAlert,
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-001/shelve", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ shelvedUntilTimestamp: 1700086400, shelvingReason: "Maintenance window" }),
    }, env);
    expect(res.status).toBe(200);
    expect(mocks.shelveAlert).toHaveBeenCalledWith(env, "alert-001", "org-001", "user-001", 1700086400, "Maintenance window");
  });

  it("POST /api/alerts/:alertId/shelve returns 400 for invalid body", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-001/shelve", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ shelvingReason: "Missing timestamp" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("POST /api/alerts/:alertId/shelve returns 404 for missing alert", async () => {
    mocks.shelveAlert.mockResolvedValue({ success: false, error: "Alert not found" });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
    const res = await app.request("/api/alerts/alert-gone/shelve", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ shelvedUntilTimestamp: 1700086400, shelvingReason: "Maintenance" }),
    }, env);
    expect(res.status).toBe(404);
  });

  // --- POST /api/push-subscriptions ---
  it("POST /api/push-subscriptions registers subscription", async () => {
    mocks.createPushSubscription.mockResolvedValue({
      success: true, subscription: { id: "sub-001", endpoint: "https://push.example.com/abc" },
    });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const reqBody = {
      endpoint: "https://push.example.com/abc",
      p256dhKey: "key123",
      authKey: "auth456",
    };
    const res = await app.request("/api/push-subscriptions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    }, env);
    expect(res.status).toBe(201);
    expect(mocks.createPushSubscription).toHaveBeenCalledWith(env, "org-001", "user-001", reqBody);
  });

  it("POST /api/push-subscriptions returns 400 for invalid input", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders();
    const res = await app.request("/api/push-subscriptions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "not-a-url", p256dhKey: "", authKey: "" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("POST /api/push-subscriptions returns 403 when user has no org", async () => {
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ org_id: null });
    const res = await app.request("/api/push-subscriptions", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example.com/abc", p256dhKey: "k", authKey: "a" }),
    }, env);
    expect(res.status).toBe(403);
  });

  // --- admin_vilcami sees all orgs (null filter) ---
  it("GET /api/alerts passes null filter for admin_vilcami role", async () => {
    mocks.listAlerts.mockResolvedValue({ alerts: [], total: 0, page: 1, limit: 20 });
    const app = mountApp();
    const env = createTestEnv();
    const headers = await createAuthHeaders({ role: "admin_vilcami", org_id: "vilcami" });
    await app.request("/api/alerts", { headers }, env);
    expect(mocks.listAlerts).toHaveBeenCalledWith(env, null, { page: 1, limit: 20 });
  });
});