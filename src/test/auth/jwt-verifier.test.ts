import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../../types/env";

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

function createTestEnv(publicKeyJwk: JsonWebKey): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({ keys: [publicKeyJwk], cachedAt: Date.now() }),
      ),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    ENCRYPTION_KEY: "test",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test",
  };
}

describe("JWT Verifier", () => {
  let testPrivateKey: CryptoKey;
  let testPublicKeyJwk: JsonWebKey;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    originalFetch = globalThis.fetch;

    const keyPair = await generateTestKeyPair();
    testPrivateKey = keyPair.privateKey;
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    testPublicKeyJwk = { ...exported, kid: "test-key-id", alg: "RS256" } as unknown as JsonWebKey;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should verify a valid RS256 JWT and extract claims", async () => {
    const payload = {
      sub: "user-001",
      org_id: "org-001",
      role: "admin",
      aal: "aal2",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, testPrivateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(true);
    expect(result.payload?.sub).toBe("user-001");
    expect(result.payload?.org_id).toBe("org-001");
    expect(result.payload?.role).toBe("admin");
    expect(result.payload?.mfa_verified).toBe(true); // aal2 => true
  });

  it("should reject an expired JWT", async () => {
    const payload = {
      sub: "user-001",
      org_id: "org-001",
      role: "user",
      aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) - 3600,
      iat: Math.floor(Date.now() / 1000) - 7200,
    };
    const token = await createSignedJwt(payload, testPrivateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("expired");
  });

  it("should reject a JWT with wrong issuer", async () => {
    const payload = {
      sub: "user-001",
      org_id: "org-001",
      role: "user",
      aal: "aal1",
      iss: "https://evil-attacker.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, testPrivateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("issuer");
  });

  it("should reject a JWT with invalid signature (different key)", async () => {
    const attackerKeyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const payload = {
      sub: "attacker",
      org_id: "org-001",
      role: "admin_vilcami",
      aal: "aal2",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, attackerKeyPair.privateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("signature");
  });

  it("should map aal1 to mfa_verified=false", async () => {
    const payload = {
      sub: "user-001",
      org_id: "org-001",
      role: "user",
      aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, testPrivateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(true);
    expect(result.payload?.mfa_verified).toBe(false);
  });

  it("should default role to 'user' when missing from claims", async () => {
    const payload = {
      sub: "user-001",
      org_id: "org-001",
      aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, testPrivateKey);
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(true);
    expect(result.payload?.role).toBe("user");
  });

  it("should reject a malformed token (not 3 parts)", async () => {
    const env = createTestEnv(testPublicKeyJwk);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt("not-a-jwt", env);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it("should return 503 when JWKS fetch fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const env = {
      ...createTestEnv(testPublicKeyJwk),
      SECRETS_VAULT: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      } as unknown as KVNamespace,
    };

    const payload = {
      sub: "user-001",
      org_id: "org-001",
      role: "user",
      aal: "aal1",
      iss: "https://test-project.supabase.co",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const token = await createSignedJwt(payload, testPrivateKey);

    const { verifyJwt } = await import("../../auth/jwt-verifier");
    const result = await verifyJwt(token, env);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(503);
  });
});