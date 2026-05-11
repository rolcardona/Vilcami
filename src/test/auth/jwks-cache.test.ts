import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../../types/env";

async function generateTestKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

let testPublicKeyJwk: JsonWebKey;

function createMockEnv(kvGetResult: string | null = null): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn().mockResolvedValue(kvGetResult),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
  };
}

describe("JWKS Cache Service", () => {
  let getJwksPublicKeys: (env: Env) => Promise<Map<string, JsonWebKey>>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Generate a test key pair for JWKS responses
    const keyPair = await generateTestKeyPair();
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    testPublicKeyJwk = { ...exported, kid: "test-key-id", alg: "RS256" } as unknown as JsonWebKey;

    // Mock globalThis.fetch to return our test JWKS
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [testPublicKeyJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Import fresh module after setting up mocks
    const module = await import("../../auth/jwks-cache.service");
    getJwksPublicKeys = module.getJwksPublicKeys;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should fetch JWKS from Supabase when KV cache is empty", async () => {
    const env = createMockEnv(null);
    const keys = await getJwksPublicKeys(env);
    expect(keys.size).toBeGreaterThan(0);
    expect(keys.has("test-key-id")).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://test-project.supabase.co/auth/v1/jwks",
      expect.objectContaining({ headers: expect.objectContaining({ apikey: "test-anon-key" }) }),
    );
  });

  it("should return cached keys from KV when available and not expired", async () => {
    const cachedJwks = JSON.stringify({
      keys: [testPublicKeyJwk],
      cachedAt: Date.now(),
    });
    const env = createMockEnv(cachedJwks);
    const keys = await getJwksPublicKeys(env);
    expect(keys.has("test-key-id")).toBe(true);
    // fetch should NOT have been called since KV cache hit
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("should cache fetched keys in KV with 1-hour TTL", async () => {
    const env = createMockEnv(null);
    await getJwksPublicKeys(env);
    expect(env.SECRETS_VAULT.put).toHaveBeenCalledWith(
      expect.stringContaining("jwks:"),
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 }),
    );
  });

  it("should re-fetch when KV cache is expired (old cachedAt)", async () => {
    const expiredCache = JSON.stringify({
      keys: [testPublicKeyJwk],
      cachedAt: Date.now() - 3700000, // Older than 1 hour
    });
    const env = createMockEnv(expiredCache);
    const keys = await getJwksPublicKeys(env);
    expect(keys.size).toBeGreaterThan(0);
    // fetch should have been called to re-fetch from Supabase
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("should use in-memory fallback when KV read fails", async () => {
    const env = createMockEnv(null);
    // First call populates in-memory cache by fetching from Supabase
    await getJwksPublicKeys(env);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Create a second env where KV fails
    const envKvFail = createMockEnv(null);
    (envKvFail.SECRETS_VAULT.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("KV error"));
    // Second call should use in-memory cache
    const keys = await getJwksPublicKeys(envKvFail);
    expect(keys.size).toBeGreaterThan(0);
  });

  it("should throw when both KV and Supabase fetch fail", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    const env = createMockEnv(null);
    await expect(getJwksPublicKeys(env)).rejects.toThrow("Network error");
  });

  it("should ignore cache entries with malformed JSON", async () => {
    const env = createMockEnv("not-valid-json");
    const keys = await getJwksPublicKeys(env);
    // Should fall through to fetch from Supabase
    expect(keys.size).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});