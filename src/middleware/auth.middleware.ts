import type { Context, Next } from "hono";
import type { Env } from "../types/env";
import { verifyJwt, type JwtPayload } from "../auth/jwt-verifier";

export type { JwtPayload };

/**
 * Hono middleware that extracts and validates JWT from the Authorization header.
 *
 * - Extracts the Bearer token and verifies it against Supabase JWKS.
 * - Enforces MFA verification for admin role (aal2 required).
 * - Sets `jwtPayload` on the Hono context for downstream middleware/handlers.
 * - Returns 401 when the token is missing/malformed/invalid.
 * - Returns 403 when admin role lacks MFA (aal1 instead of aal2).
 */
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authorizationHeader = c.req.header("Authorization");

  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authorizationHeader.slice(7); // Remove "Bearer " prefix

  if (!token.trim()) {
    return c.json({ error: "Empty bearer token" }, 401);
  }

  const result = await verifyJwt(token, c.env);

  if (!result.valid) {
    const statusCode = result.statusCode ?? 401;
    return c.json({ error: result.error ?? "Unauthorized" }, statusCode as 401 | 403 | 503);
  }

  // Enforce MFA for admin role
  if (result.payload!.role === "admin" && !result.payload!.mfa_verified) {
    return c.json({ error: "Admin role requires MFA verification" }, 403);
  }

  c.set("jwtPayload", result.payload!);
  await next();
}

/**
 * Hono middleware that computes the organization-scoping filter from the JWT payload.
 *
 * MUST run after authMiddleware, which sets `jwtPayload` on the context.
 * Sets `organizationFilter`: null for admin_vilcami (sees all orgs),
 * org_id string for admin and user roles (scoped to their organization).
 */
export async function orgScopingMiddleware(c: Context, next: Next): Promise<void> {
  const jwtPayload = c.get("jwtPayload") as JwtPayload;
  const organizationFilter = getOrganizationFilter(jwtPayload);
  c.set("organizationFilter", organizationFilter);
  c.set("organizationId", jwtPayload.org_id ?? "");
  await next();
}

function getOrganizationFilter(payload: JwtPayload): string | null {
  if (payload.role === "admin_vilcami") {
    return null;
  }
  return payload.org_id;
}

// Extend Hono's context variable map so TypeScript recognizes our custom keys
declare module "hono" {
  interface ContextVariableMap {
    jwtPayload: JwtPayload;
    organizationFilter: string | null;
    organizationId: string;
  }
}