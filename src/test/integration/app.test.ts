import { describe, it, expect } from "vitest";
import { app } from "../../index";
import type { Env } from "../../types/env";

function createTestEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {} as KVNamespace,
    SECRETS_VAULT: {} as KVNamespace,
    THROTTLE_KV: {} as KVNamespace,
    ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test-project.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    FRONTEND_URL: "http://localhost:5173",
    AI: { run: () => Promise.resolve({}) } as unknown as Ai,
  };
}

const env = createTestEnv();

describe("Worker Integration", () => {
  it("GET / should return ok status", async () => {
    const res = await app.request("/", undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service?: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("vilcami");
  });

  it("GET /health should return healthy", async () => {
    const res = await app.request("/health", undefined, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; timestamp?: string };
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeDefined();
  });

  it("GET /api/devices should return 401 without auth", async () => {
    const res = await app.request("/api/devices", undefined, env);
    expect(res.status).toBe(401);
  });

  it("POST /api/telemetry/ingest should return 401 without auth", async () => {
    const res = await app.request("/api/telemetry/ingest", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("should return 404 for unknown routes", async () => {
    const res = await app.request("/nonexistent", undefined, env);
    expect(res.status).toBe(404);
  });
});