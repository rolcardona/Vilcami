import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";
import { ALL_PERMISSIONS, DEFAULT_USER_PERMISSIONS } from "../../types/permissions.types";

// ---------------------------------------------------------------------------
// Mocks — chainable Drizzle DB builder
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockAll = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  get: mockGet,
  all: mockAll,
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  run: vi.fn().mockResolvedValue({ meta: {} }),
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

vi.mock("../../middleware/auth.middleware", () => ({
  authMiddleware: async (_c: any, next: any) => next(),
  orgScopingMiddleware: async (_c: any, next: any) => next(),
}));

vi.mock("../../middleware/subscription.middleware", () => ({
  requireSubscription: () => async (_c: any, next: any) => next(),
  requireFeature: () => async (_c: any, next: any) => next(),
  requireDeviceQuota: () => async (_c: any, next: any) => next(),
}));

import { memberRoutes } from "../../routes/members.routes";

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
  return { sub, role, org_id: orgId, email: "test@vilcami.com" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /members/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockGet.mockReset();
    mockAll.mockReset();
  });

  it("returns all permissions for admin_vilcami", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin_vilcami"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.route("/", memberRoutes);

    const res = await app.request("/me", undefined, createTestEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; permissions: string[] };
    expect(body.role).toBe("admin_vilcami");
    expect(body.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it("returns all permissions for admin", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("admin"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.route("/", memberRoutes);

    const res = await app.request("/me", undefined, createTestEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; permissions: string[] };
    expect(body.role).toBe("admin");
    expect(body.permissions).toEqual([...ALL_PERMISSIONS]);
  });

  it("returns user-specific permissions from DB", async () => {
    mockGet.mockResolvedValueOnce({
      permissions: '["devices:create","alerts:acknowledge"]',
    });

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.route("/", memberRoutes);

    const res = await app.request("/me", undefined, createTestEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; permissions: string[] };
    expect(body.role).toBe("user");
    expect(body.permissions).toEqual(["devices:create", "alerts:acknowledge"]);
  });

  it("returns default user permissions when member not found in DB", async () => {
    mockGet.mockResolvedValueOnce(null);

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("jwtPayload" as never, makeJwtPayload("user"));
      c.set("organizationId" as never, "org-001");
      await next();
    });
    app.route("/", memberRoutes);

    const res = await app.request("/me", undefined, createTestEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; permissions: string[] };
    expect(body.role).toBe("user");
    expect(body.permissions).toEqual([...DEFAULT_USER_PERMISSIONS]);
  });
});