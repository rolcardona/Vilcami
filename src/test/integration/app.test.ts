import { describe, it, expect } from "vitest";
import { app } from "../../index";

describe("Worker Integration", () => {
  it("GET / should return ok status", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service?: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("vilcami");
  });

  it("GET /health should return healthy", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; timestamp?: string };
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeDefined();
  });

  it("GET /api/devices should return 401 without auth", async () => {
    const res = await app.request("/api/devices");
    expect(res.status).toBe(401);
  });

  it("POST /api/telemetry/ingest should return 401 without auth", async () => {
    const res = await app.request("/api/telemetry/ingest", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("should return 404 for unknown routes", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });
});
