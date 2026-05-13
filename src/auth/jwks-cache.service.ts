import type { Env } from "../types/env";

const JWKS_CACHE_TTL = 3600; // 1 hour in seconds
const CACHE_KEY_PREFIX = "jwks:supabase";

let memoryCache: Map<string, JsonWebKey> | null = null;
let memoryCacheAt: number = 0;
const MEMORY_CACHE_MAX_AGE = 3600000; // 1 hour in ms

function getCacheKey(env: Env): string {
  return `${CACHE_KEY_PREFIX}:${env.SUPABASE_URL}`;
}

async function fetchJwksFromSupabase(env: Env): Promise<JsonWebKey[]> {
  const jwksUrl = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const response = await fetch(jwksUrl, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { keys: JsonWebKey[] };
  return data.keys;
}

function parseCachedKeys(cached: string): Map<string, JsonWebKey> | null {
  try {
    const parsed = JSON.parse(cached) as { keys: JsonWebKey[]; cachedAt: number };
    const isExpired = Date.now() - parsed.cachedAt > JWKS_CACHE_TTL * 1000;
    if (isExpired) return null;
    const map = new Map<string, JsonWebKey>();
    for (const key of parsed.keys) {
      const kid = (key as unknown as Record<string, unknown>).kid as string | undefined;
      if (kid) map.set(kid, key);
    }
    return map;
  } catch {
    return null;
  }
}

export async function getJwksPublicKeys(env: Env): Promise<Map<string, JsonWebKey>> {
  // 1. Try in-memory cache (fastest)
  if (memoryCache && Date.now() - memoryCacheAt < MEMORY_CACHE_MAX_AGE) {
    return new Map(memoryCache);
  }

  // 2. Try KV cache
  const cacheKey = getCacheKey(env);
  try {
    const cached = await env.SECRETS_VAULT.get(cacheKey);
    if (cached) {
      const parsed = parseCachedKeys(cached);
      if (parsed) {
        memoryCache = parsed;
        memoryCacheAt = Date.now();
        return new Map(parsed);
      }
    }
  } catch {
    // KV read failed, continue to fetch
  }

  // 3. Fetch from Supabase
  const keys = await fetchJwksFromSupabase(env);
  const keyMap = new Map<string, JsonWebKey>();
  for (const key of keys) {
    const kid = (key as unknown as Record<string, unknown>).kid as string | undefined;
    if (kid) keyMap.set(kid, key);
  }

  // 4. Cache in KV
  const cacheValue = JSON.stringify({ keys, cachedAt: Date.now() });
  try {
    await env.SECRETS_VAULT.put(cacheKey, cacheValue, {
      expirationTtl: JWKS_CACHE_TTL,
    });
  } catch {
    // KV write failed, in-memory cache still works
  }

  // 5. Update in-memory cache
  memoryCache = keyMap;
  memoryCacheAt = Date.now();

  return new Map(keyMap);
}