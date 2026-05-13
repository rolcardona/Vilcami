import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";
import { requirePermission } from "../../middleware/permission.middleware";
import type { Permission } from "../../types/permissions.types";

// ---------------------------------------------------------------------------
// Mocks — chainable Drizzle DB builder pattern (same as ai-orchestrator test)
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  get: mockGet,
  all: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  run: vi.fn(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
};

vi.mock("../../utils/db.util", () => ({
  getDrizzleDb: vi.fn(() => mockDb),
}));

vi.mock("../../schema/organization-members", () => ({
  organizationMembers: {
    id: "id",
    supabaseUserId: "supabase_user_id",
    role: "role",
    permissions: "permissions",
    status: "status",
    organizationId: "organization_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, op: "eq" })),
  and: vi.fn((...conditions) => ({ conditions, op: "and" })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({ keys: [], cachedAt: Date.now() }),
      ),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    THROTTLE_KV: {} as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    FRONTEND_URL: "http://localhost:5173",
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

function makeJwtPayload(
  role: "admin_vilcami" | "admin" | "user",
  orgId = "org-001",
  sub = "user-001",
) {
  return {
    sub,
    role,
    org_id: orgId,
    email: "test@vilcami.com",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requirePermission middleware", () => {
  beforeEach(() => {
    // Restore mockReturnThis after reset
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockGet.mockReset();
  });

  // -------------------------------------------------------------------------
  // admin always passes
  // -------------------------------------------------------------------------
  it("allows admin regardless of permission", async () => {
    const env = createTestEnv();

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin"));
      await next();
    });
    app.use("*", requirePermission("billing:manage"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // admin_vilcami always passes
  // -------------------------------------------------------------------------
  it("allows admin_vilcami regardless of permission", async () => {
    const env = createTestEnv();

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin_vilcami"));
      await next();
    });
    app.use("*", requirePermission("billing:manage"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // user with specific permission passes
  // -------------------------------------------------------------------------
  it("allows user with the required permission", async () => {
    const env = createTestEnv();

    mockGet.mockResolvedValueOnce({
      permissions: '["devices:create","telemetry:ingest"]',
    });

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.use("*", requirePermission("devices:create"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // user without permission gets 403
  // -------------------------------------------------------------------------
  it("rejects user without the required permission with 403", async () => {
    const env = createTestEnv();

    mockGet.mockResolvedValueOnce({
      permissions: '["telemetry:ingest"]',
    });

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.use("*", requirePermission("devices:delete"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string; required: string };
    expect(body.error).toBe("permission_denied");
    expect(body.required).toBe("devices:delete");
  });

  // -------------------------------------------------------------------------
  // user with empty permissions array can only read (gets 403 on writes)
  // -------------------------------------------------------------------------
  it("rejects user with empty permissions array on write operations", async () => {
    const env = createTestEnv();

    mockGet.mockResolvedValueOnce({ permissions: "[]" });

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.use("*", requirePermission("devices:create"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // user not found in organization_members gets 403
  // -------------------------------------------------------------------------
  it("rejects user not found in organization_members with 403", async () => {
    const env = createTestEnv();

    mockGet.mockResolvedValueOnce(null);

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user", "org-001", "unknown-user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.use("*", requirePermission("devices:create"));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string; required: string };
    expect(body.error).toBe("permission_denied");
  });

  // -------------------------------------------------------------------------
  // all permissions work for admin
  // -------------------------------------------------------------------------
  it.each([
    "devices:create",
    "devices:update",
    "devices:delete",
    "telemetry:ingest",
    "alerts:acknowledge",
    "alerts:resolve",
    "alerts:shelve",
    "billing:manage",
  ] as Permission[])("allows admin for permission %s", async (permission) => {
    const env = createTestEnv();

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin"));
      await next();
    });
    app.use("*", requirePermission(permission));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // all permissions work for admin_vilcami
  // -------------------------------------------------------------------------
  it.each([
    "devices:create",
    "devices:update",
    "devices:delete",
    "telemetry:ingest",
    "alerts:acknowledge",
    "alerts:resolve",
    "alerts:shelve",
    "billing:manage",
  ] as Permission[])("allows admin_vilcami for permission %s", async (permission) => {
    const env = createTestEnv();

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin_vilcami"));
      await next();
    });
    app.use("*", requirePermission(permission));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", undefined, env);
    expect(res.status).toBe(200);
  });
});