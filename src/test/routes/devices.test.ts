import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

vi.mock("../../services/device-management.service", () => ({
  listDevices: vi.fn(), getDevice: vi.fn(), createDevice: vi.fn(),
  updateDevice: vi.fn(), deleteDevice: vi.fn(),
}));

vi.mock("../../middleware/subscription.middleware", () => ({
  requireSubscription: () => async (_c: any, next: any) => next(),
  requireDeviceQuota: () => async (_c: any, next: any) => next(),
  requireFeature: () => async (_c: any, next: any) => next(),
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
    FRONTEND_URL: "http://localhost:5173",
  };
}

function makeDeviceFabric(overrides: Record<string, unknown> = {}) {
  return {
    id: "dev-001", organizationId: "org-001", name: "Sensor Frio Camara 3",
    deviceExternalId: "ext-abc-123", protocolType: "modbus",
    location: "Camara Frigorifica 3", latitude: -34.6037, longitude: -58.3816,
    status: "offline", lastSeenAt: null, createdAt: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

describe("Device Routes", () => {
  let deviceRoutesModule: { deviceRoutes: Hono<{ Bindings: Env }> };
  let svc: Record<string, ReturnType<typeof vi.fn>>;

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
    svc = (await import("../../services/device-management.service")) as unknown as typeof svc;
    deviceRoutesModule = await import("../../routes/devices.routes");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mountApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/devices", deviceRoutesModule.deviceRoutes);
    return app;
  }

  async function createAuthHeaders(overrides: Record<string, unknown> = {}): Promise<Record<string, string>> {
    // Build JWT claims — aal is derived from mfa_verified for the verifier
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

  describe("auth guards", () => {
    it("returns 401 for missing, malformed, or non-Bearer Authorization header", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const noAuth = await app.request("/api/devices", undefined, env);
      const badAuth = await app.request("/api/devices", { headers: { Authorization: "x" } }, env);
      expect(noAuth.status).toBe(401);
      expect(badAuth.status).toBe(401);
    });

    it("returns 403 for admin without MFA", async () => {
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: false });
      const res = await app.request("/api/devices", { headers }, env);
      expect(res.status).toBe(403);
    });

    it("passes null filter for admin_vilcami, org_id filter for user", async () => {
      svc.listDevices.mockResolvedValue({ devices: [], total: 0 });
      const app = mountApp();
      const env = createTestEnv();
      const headers1 = await createAuthHeaders({ role: "admin_vilcami", org_id: "vilcami" });
      await app.request("/api/devices", { headers: headers1 }, env);
      const headers2 = await createAuthHeaders({ role: "user", org_id: "org-abc" });
      await app.request("/api/devices", { headers: headers2 }, env);
      expect(svc.listDevices.mock.calls[0][1]).toBe(null);
      expect(svc.listDevices.mock.calls[1][1]).toBe("org-abc");
    });
  });

  describe("GET /api/devices", () => {
    it("returns device list for authenticated org, empty list when none", async () => {
      svc.listDevices.mockResolvedValueOnce({
        devices: [makeDeviceFabric(), makeDeviceFabric({ id: "dev-002", name: "Camara 5" })], total: 2,
      }).mockResolvedValueOnce({ devices: [], total: 0 });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res1 = await app.request("/api/devices", { headers }, env);
      const res2 = await app.request("/api/devices", { headers }, env);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const body1 = (await res1.json()) as { devices: unknown[]; total: number };
      const body2 = (await res2.json()) as { devices: unknown[]; total: number };
      expect(body1.devices).toHaveLength(2);
      expect(body2.devices).toHaveLength(0);
    });
  });

  describe("GET /api/devices/:deviceId", () => {
    it("returns device by id", async () => {
      svc.getDevice.mockResolvedValue({ device: makeDeviceFabric() });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders();
      const res = await app.request("/api/devices/dev-001", { headers }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { device: Record<string, unknown> };
      expect(body.device.id).toBe("dev-001");
      expect(svc.getDevice.mock.calls[0][1]).toBe("dev-001");
      expect(svc.getDevice.mock.calls[0][2]).toBe("org-001");
    });

    it("returns 404 for non-existent device", async () => {
      svc.getDevice.mockResolvedValue({ device: null });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders();
      const res = await app.request("/api/devices/dev-gone", { headers }, env);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe("POST /api/devices", () => {
    it("returns 201 with created device on success", async () => {
      svc.createDevice.mockResolvedValue({
        success: true, device: makeDeviceFabric({ id: "dev-new", name: "Nueva Camara" }),
      });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const reqBody = { name: "Nueva Camara", deviceExternalId: "ext-new-001", protocolType: "modbus", location: "Sotano 2" };
      const res = await app.request("/api/devices", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      }, env);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { device: Record<string, unknown> };
      expect(body.device.name).toBe("Nueva Camara");
      expect(svc.createDevice.mock.calls[0][1]).toEqual(reqBody);
      expect(svc.createDevice.mock.calls[0][2]).toBe("org-001");
    });

    it("returns 400 when service rejects invalid input", async () => {
      svc.createDevice.mockResolvedValue({ success: false, error: "Validation failed: name: Required" });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/devices", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      }, env);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/validation/i);
    });
  });

  describe("PATCH /api/devices/:deviceId", () => {
    it("updates and returns device", async () => {
      svc.updateDevice.mockResolvedValue({
        success: true, device: makeDeviceFabric({ name: "Actualizado", location: "Nueva Ubicacion" }),
      });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const patchBody = { name: "Actualizado" };
      const res = await app.request("/api/devices/dev-001", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      }, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { device: Record<string, unknown> };
      expect(body.device.name).toBe("Actualizado");
      expect(svc.updateDevice.mock.calls[0][1]).toBe("dev-001");
      expect(svc.updateDevice.mock.calls[0][2]).toEqual(patchBody);
      expect(svc.updateDevice.mock.calls[0][3]).toBe("org-001");
    });

    it("returns 404 when device not found", async () => {
      svc.updateDevice.mockResolvedValue({ success: false, error: "Device not found or access denied" });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/devices/dev-gone", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      }, env);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/devices/:deviceId", () => {
    it("returns 204 on successful deletion", async () => {
      svc.deleteDevice.mockResolvedValue({ success: true });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/devices/dev-001", {
        method: "DELETE", headers,
      }, env);
      expect(res.status).toBe(204);
      expect(svc.deleteDevice.mock.calls[0][1]).toBe("dev-001");
      expect(svc.deleteDevice.mock.calls[0][2]).toBe("org-001");
    });

    it("returns 404 for non-existent device", async () => {
      svc.deleteDevice.mockResolvedValue({ success: false, error: "Device not found or access denied" });
      const app = mountApp();
      const env = createTestEnv();
      const headers = await createAuthHeaders({ role: "admin", mfa_verified: true });
      const res = await app.request("/api/devices/dev-gone", {
        method: "DELETE", headers,
      }, env);
      expect(res.status).toBe(404);
    });
  });
});