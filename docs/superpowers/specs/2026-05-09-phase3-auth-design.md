# Phase 3 AUTH — Supabase Auth + JWT Verification + MFA

**Date:** 2026-05-09
**Phase:** 3 of 6
**Status:** Design approved, pending implementation

---

## Architecture

```
Client (React SPA)
  ↓ sign-up / sign-in / MFA via Supabase JS SDK
  ↓ receives JWT with custom claims (org_id, role, aal)
  ↓ sends Authorization: Bearer <jwt>
  ↓
Worker (Hono)
  ↓ authMiddleware
  ↓   → jwtVerifier(token)
  ↓     → jwksCache.getPublicKeys()
  ↓       → KV cache hit? return keys
  ↓       → KV miss? fetch GET {SUPABASE_URL}/auth/v1/jwks
  ↓       → cache in KV with 1h TTL
  ↓     → verify RS256 signature with crypto.subtle
  ↓     → validate claims: exp, iss, sub, aal
  ↓     → extract: org_id, role, mfa_verified (aal2=true, aal1=false)
  ↓
  ✅ admin_vilcami → organizationFilter = null (sees all orgs)
  ✅ admin (aal2)  → organizationFilter = org_id
  ✅ user          → organizationFilter = org_id
  ❌ admin (aal1)  → 403 "Admin role requires MFA verification"
  ❌ invalid/expired → 401 "Unauthorized"
```

## Components

### 1. JWKS Cache Service — `src/auth/jwks-cache.service.ts`

- Fetches Supabase JWKS from `{SUPABASE_URL}/auth/v1/jwks`
- Caches in KV (`SECRETS_VAULT`) with 1-hour TTL
- In-memory fallback if KV read fails
- Returns `Map<string, JsonWebKey>` keyed by `kid`
- **Pure KV operations** — no D1, no side effects beyond cache

```typescript
interface JwksCacheService {
  getPublicKeys(env: Env): Promise<Map<string, JsonWebKey>>;
}
```

Cache key in KV: `jwks:supabase:{SUPABASE_URL}`
Cache value: JSON `{ keys: [...], cachedAt: timestamp }`

### 2. JWT Verifier — `src/auth/jwt-verifier.ts`

Replaces the stub `extractJwtPayload` from `jwt-stub.middleware.ts`.

- Splits JWT, decodes header to get `kid`
- Looks up matching public key from JWKS cache
- Verifies RS256 signature using `crypto.subtle.verify()`
- Validates claims: `exp`, `iss` (must match `SUPABASE_URL`), `sub`
- Extracts custom claims: `org_id`, `role`, `aal`
- Maps `aal` to `mfa_verified`: `aal2` → true, `aal1` → false

```typescript
interface JwtVerificationResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
  statusCode?: number;
}

interface JwtPayload {
  sub: string;           // Supabase user ID
  org_id: string | null; // Organization ID (from custom claims hook)
  role: "admin_vilcami" | "admin" | "user";
  mfa_verified: boolean; // Derived from aal claim
  email?: string;
  exp: number;
  iat: number;
  iss: string;
}
```

Error cases:
- Missing/malformed token → `{ valid: false, error: "...", statusCode: 401 }`
- Expired token → `{ valid: false, error: "Token expired", statusCode: 401 }`
- Invalid signature → `{ valid: false, error: "Invalid signature", statusCode: 401 }`
- Wrong issuer → `{ valid: false, error: "Invalid issuer", statusCode: 401 }`

### 3. Auth Middleware Update — `src/middleware/auth.middleware.ts`

- Replace `extractJwtPayload()` call with `jwtVerifier.verify(token, env)`
- Replace `verifyMfaForAdmin()` call with `aal`-based check
- Keep `orgScopingMiddleware` unchanged (already correct)
- Keep context variable names: `jwtPayload`, `organizationFilter`

### 4. Env Type Update — `src/types/env.ts`

```typescript
export interface Env {
  DB: D1Database;
  TELEMETRY_RAW: KVNamespace;
  SECRETS_VAULT: KVNamespace;
  ENCRYPTION_KEY: string;
  SUPABASE_URL: string;       // NEW
  SUPABASE_ANON_KEY: string;  // NEW
}
```

### 5. Supabase Local Dev — `supabase/` directory

- `supabase/config.toml` — local Supabase configuration
- `supabase/migrations/001_custom_claims_hook.sql` — the Auth Hook function
- `.dev.vars` — `SUPABASE_URL` and `SUPABASE_ANON_KEY` (gitignored)

### 6. Custom Access Token Hook (SQL)

Deployed to Supabase via Dashboard → Authentication → Hooks or via `supabase db push`.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
  declare
    claims jsonb;
    member record;
  begin
    select organization_id, role into member
      from public.organization_members
      where supabase_user_id = (event->>'user_id')::uuid
      limit 1;

    claims := event->'claims';

    if member.organization_id is not null then
      claims := jsonb_set(claims, '{org_id}', to_jsonb(member.organization_id));
      claims := jsonb_set(claims, '{role}', to_jsonb(member.role));
    else
      claims := jsonb_set(claims, '{org_id}', 'null');
      claims := jsonb_set(claims, '{role}', to_jsonb('user'));
    end if;

    return jsonb_set(event, '{claims}', claims);
  end;
$$;
```

This hook:
- Runs at every JWT issuance (dynamic, no refresh needed)
- Reads from `organization_members` table (already in our D1 schema)
- Injects `org_id` and `role` as custom JWT claims
- Defaults to `role: 'user'` and `org_id: null` if no membership found

**Important:** This hook runs on the Supabase PostgreSQL instance, NOT on the D1 database. The `organization_members` table must exist in Supabase's PostgreSQL for this to work. We need a strategy to keep memberships in sync (see Sync Strategy below).

### 7. Membership Sync Strategy

Since the Custom Access Token Hook reads from Supabase PostgreSQL (not D1), we need memberships in both places:

**Option: Write-through on Worker**
- When `createDevice` or `createOrganization` creates/updates memberships in D1, the Worker also calls `supabase.auth.admin.updateUserById()` to set `raw_app_meta_data`
- Simpler, no additional infra
- Membership changes propagate on next token refresh (or via Auth Hook which reads from Supabase PostgreSQL)

**Option: Supabase PostgreSQL as source of truth for memberships**
- Migrate `organization_members` to Supabase PostgreSQL
- D1 syncs from Supabase via periodic Worker or webhook
- More complex but Auth Hook reads fresh data

**Chosen: Write-through on Worker** — simpler for Phase 3, memberships are low-volume.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/auth/jwks-cache.service.ts` | CREATE | JWKS cache with KV + in-memory fallback |
| `src/auth/jwt-verifier.ts` | CREATE | RS256 JWT verification against JWKS |
| `src/middleware/auth.middleware.ts` | MODIFY | Use jwtVerifier instead of stub |
| `src/middleware/jwt-stub.middleware.ts` | DELETE | Replaced by jwt-verifier |
| `src/types/env.ts` | MODIFY | Add SUPABASE_URL, SUPABASE_ANON_KEY |
| `wrangler.toml` | MODIFY | Add [vars] section |
| `.dev.vars` | MODIFY | Add SUPABASE_ANON_KEY (already has URL) |
| `src/test/auth/jwks-cache.test.ts` | CREATE | TDD tests |
| `src/test/auth/jwt-verifier.test.ts` | CREATE | TDD tests |
| `src/test/middleware/auth.test.ts` | MODIFY | Updated for real JWT verification |
| `supabase/config.toml` | CREATE | Local Supabase config |
| `supabase/migrations/001_custom_claims_hook.sql` | CREATE | Auth Hook SQL |

## TDD Order

1. Write test for `jwks-cache.service` → implement
2. Write test for `jwt-verifier` → implement
3. Update `auth.middleware.ts` to use real verifier → update tests
4. Delete `jwt-stub.middleware.ts` → clean up test imports
5. Update `Env` type and `wrangler.toml`
6. Set up `supabase/` directory and custom claims hook
7. Integration test: full auth flow through middleware

## Security Considerations

- JWKS public keys are cached with 1h TTL — limits window for key rotation
- JWT `exp` claim checked — expired tokens rejected
- JWT `iss` claim validated against `SUPABASE_URL` — prevents token confusion
- `aal` claim checked for admin MFA enforcement
- `org_id` and `role` from JWT (set by Auth Hook) — not trusted blindly, verified against signature
- `SUPABASE_ANON_KEY` is public (designed for client-side) — safe in `.dev.vars`
- No JWT_SECRET needed — we use JWKS public keys for verification, not HMAC

## Out of Scope for Phase 3

- Sign-up / sign-in / password reset UI (Phase 6)
- MFA enrollment UI (Phase 6)
- User invitation flow (future)
- Organization creation via API (Phase 3 only handles org-scoping of existing orgs)
- Rate limiting on auth endpoints (future)