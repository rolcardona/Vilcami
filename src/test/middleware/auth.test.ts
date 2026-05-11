import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";
import type { JwtPayload } from "../../auth/jwt-verifier";
import { authMiddleware, orgScopingMiddleware } from "../../middleware/auth.middleware";

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

// Shared key pair generated once for all tests in this file
let testPrivateKey: CryptoKey;
let testPublicKeyJwk: JsonWebKey;

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

describe("authMiddleware", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    const keyPair = await generateTestKeyPair();
    testPrivateKey = keyPair.privateKey;
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    testPublicKeyJwk = { ...exported, kid: "test-key-id", alg: "RS256" } as unknown as JsonWebKey;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    // Mock fetch to prevent real JWKS calls during tests
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [testPublicKeyJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", authMiddleware);
    app.get("/test", (c) => c.json(c.get("jwtPayload")));
    return app;
  }

  it("should return 401 when no Authorization header is present", async () => {
    const app = createApp();
    const env = createTestEnv();
    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(401);
  });

  it("should return 401 when Authorization header lacks Bearer prefix", async () => {
    const app = createApp();
    const env = createTestEnv();
    const res = await app.request("/test", { headers: { Authorization: "something" } }, env);
    expect(res.status).toBe(401);
  });

  it("should return 401 for empty Bearer token", async () => {
    const app = createApp();
    const env = createTestEnv();
    const res = await app.request("/test", { headers: { Authorization: "Bearer  " } }, env);
    expect(res.status).toBe(401);
  });

  it("should return 401 for malformed JWT token (not 3 parts)", async () => {
    const app = createApp();
    const env = createTestEnv();
    const res = await app.request("/test", { headers: { Authorization: "Bearer bad.token" } }, env);
    expect(res.status).toBe(401);
  });

  it("should set jwtPayload and return 200 for a valid user token", async () => {
    const app = createApp();
    const env = createTestEnv();
    const token = await createSignedJwt({
      sub: "user-001", org_id: "org-001", role: "user", aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    }, testPrivateKey);
    const res = await app.request("/test", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as JwtPayload;
    expect(body.role).toBe("user");
    expect(body.org_id).toBe("org-001");
    expect(body.mfa_verified).toBe(false);
  });

  it("should return 403 when admin role has no MFA verified (aal1)", async () => {
    const app = createApp();
    const env = createTestEnv();
    const token = await createSignedJwt({
      sub: "admin-001", org_id: "org-001", role: "admin", aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    }, testPrivateKey);
    const res = await app.request("/test", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(403);
  });

  it("should allow admin with MFA verified (aal2)", async () => {
    const app = createApp();
    const env = createTestEnv();
    const token = await createSignedJwt({
      sub: "admin-001", org_id: "org-001", role: "admin", aal: "aal2",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    }, testPrivateKey);
    const res = await app.request("/test", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as JwtPayload;
    expect(body.role).toBe("admin");
    expect(body.mfa_verified).toBe(true);
  });

  it("should allow admin_vilcami without MFA (bypass)", async () => {
    const app = createApp();
    const env = createTestEnv();
    const token = await createSignedJwt({
      sub: "super-001", org_id: "vilcami", role: "admin_vilcami", aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    }, testPrivateKey);
    const res = await app.request("/test", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as JwtPayload;
    expect(body.role).toBe("admin_vilcami");
  });
});

describe("orgScopingMiddleware", () => {
  async function testOrgScoping(
    jwtPayload: JwtPayload,
    expectedFilter: string | null,
  ): Promise<void> {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("jwtPayload", jwtPayload);
      await next();
    });
    app.use("*", orgScopingMiddleware);
    app.get("/test", (c) => c.json({ filter: c.get("organizationFilter") }));
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = await res.json() as { filter: string | null };
    expect(body.filter).toBe(expectedFilter);
  }

  it("should set organizationFilter to null for admin_vilcami", async () => {
    await testOrgScoping({
      sub: "s-1", org_id: "vilcami", role: "admin_vilcami", mfa_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), iss: "https://test-project.supabase.co",
    }, null);
  });

  it("should set organizationFilter to org_id for admin", async () => {
    await testOrgScoping({
      sub: "a-1", org_id: "org-admin", role: "admin", mfa_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), iss: "https://test-project.supabase.co",
    }, "org-admin");
  });

  it("should set organizationFilter to org_id for user", async () => {
    await testOrgScoping({
      sub: "u-1", org_id: "org-user", role: "user", mfa_verified: false,
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), iss: "https://test-project.supabase.co",
    }, "org-user");
  });
});