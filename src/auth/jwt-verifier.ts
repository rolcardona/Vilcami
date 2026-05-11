import type { Env } from "../types/env";
import { getJwksPublicKeys } from "./jwks-cache.service";

export interface JwtPayload {
  sub: string;
  org_id: string | null;
  role: "admin_vilcami" | "admin" | "user";
  mfa_verified: boolean;
  email?: string;
  exp: number;
  iat: number;
  iss: string;
}

export interface JwtVerificationResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
  statusCode?: number;
}

function base64UrlDecode(str: string): string {
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  return atob(padded);
}

function base64UrlToUint8Array(str: string): Uint8Array {
  const binary = base64UrlDecode(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importRsaPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function verifyJwt(
  token: string,
  env: Env,
): Promise<JwtVerificationResult> {
  // 1. Split and validate format
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid JWT format", statusCode: 401 };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 2. Decode header to get kid
  let header: { kid?: string; alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
  } catch {
    return { valid: false, error: "Invalid JWT header", statusCode: 401 };
  }

  if (!header.kid) {
    return { valid: false, error: "Missing kid in JWT header", statusCode: 401 };
  }

  // 3. Get JWKS public keys
  let publicKeys: Map<string, JsonWebKey>;
  try {
    publicKeys = await getJwksPublicKeys(env);
  } catch (error) {
    return {
      valid: false,
      error: `Failed to fetch JWKS: ${error instanceof Error ? error.message : "unknown error"}`,
      statusCode: 503,
    };
  }

  const publicKeyJwk = publicKeys.get(header.kid);
  if (!publicKeyJwk) {
    return { valid: false, error: "Unknown signing key", statusCode: 401 };
  }

  // 4. Import and verify signature
  let publicKey: CryptoKey;
  try {
    publicKey = await importRsaPublicKey(publicKeyJwk);
  } catch {
    return { valid: false, error: "Invalid public key", statusCode: 401 };
  }

  const signInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);

  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    signInput,
  );

  if (!isValid) {
    return { valid: false, error: "Invalid JWT signature", statusCode: 401 };
  }

  // 5. Decode and validate payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, error: "Invalid JWT payload", statusCode: 401 };
  }

  // 6. Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { valid: false, error: "Token expired", statusCode: 401 };
  }

  // 7. Check issuer
  const expectedIssuer = env.SUPABASE_URL;
  if (payload.iss !== expectedIssuer) {
    return {
      valid: false,
      error: `Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`,
      statusCode: 401,
    };
  }

  // 8. Extract claims and build JwtPayload
  const aal = typeof payload.aal === "string" ? payload.aal : "aal1";

  const jwtPayload: JwtPayload = {
    sub: payload.sub as string,
    org_id: (payload.org_id as string) ?? null,
    role: (payload.role as "admin_vilcami" | "admin" | "user") ?? "user",
    mfa_verified: aal === "aal2",
    email: payload.email as string | undefined,
    exp: payload.exp as number,
    iat: payload.iat as number,
    iss: payload.iss as string,
  };

  return { valid: true, payload: jwtPayload };
}