import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BulkTelemetryIngestResult } from "../../services/telemetry-ingestion.service";
import { getDrizzleDb } from "../../utils/db.util";

vi.mock("../../utils/db.util", () => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {};
  mockDb.select = vi.fn(() => mockDb);
  mockDb.from = vi.fn(() => mockDb);
  mockDb.where = vi.fn(() => mockDb);
  mockDb.all = vi.fn(() => Promise.resolve([]));
  mockDb.get = vi.fn(() => Promise.resolve(null));
  mockDb.insert = vi.fn(() => mockDb);
  mockDb.values = vi.fn(() => mockDb);
  mockDb.returning = vi.fn(() => mockDb);
  mockDb.update = vi.fn(() => mockDb);
  mockDb.set = vi.fn(() => mockDb);
  mockDb.delete = vi.fn(() => mockDb);
  return { getDrizzleDb: () => mockDb };
});

function createMockEnv() {
  const putFn = vi.fn().mockResolvedValue(undefined);
  return {
    env: {
      DB: {} as D1Database,
      TELEMETRY_RAW: { put: putFn } as unknown as KVNamespace,
      SECRETS_VAULT: {} as KVNamespace,
      ENCRYPTION_KEY: "test-encryption-key",
      SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
    },
    putFn,
  };
}

describe("ingestTelemetry", () => {
  let mockEnv: ReturnType<typeof createMockEnv>["env"];
  let putFn: ReturnType<typeof createMockEnv>["putFn"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDb: any;
  let ingestTelemetry: (env: typeof mockEnv, payload: unknown, orgId: string) => Promise<{ success: boolean; telemetryId?: string; error?: string }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const setup = createMockEnv();
    mockEnv = setup.env;
    putFn = setup.putFn;
    mockDb = getDrizzleDb(mockEnv);
    const service = await import("../../services/telemetry-ingestion.service");
    ingestTelemetry = service.ingestTelemetry;
  });

  it("should accept and store valid telemetry", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-temperature-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const result = await ingestTelemetry(mockEnv, payload, "org-001");

    expect(result.success).toBe(true);
    expect(result.telemetryId).toBeDefined();
    expect(result.telemetryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(putFn).toHaveBeenCalledOnce();
    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it("should reject telemetry that fails Zod validation", async () => {
    const payload = {
      deviceId: "dev-001",
      // missing required fields: organizationId, value, unit, timestamp
    };

    const result = await ingestTelemetry(mockEnv, payload, "org-001");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.telemetryId).toBeUndefined();
    expect(putFn).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("should reject non-numeric value", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: "not-a-number",
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const result = await ingestTelemetry(mockEnv, payload, "org-001");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(putFn).not.toHaveBeenCalled();
  });

  it("should reject telemetry with organizationId mismatch", async () => {
    const payload = {
      organizationId: "org-attacker",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: 25.0,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const result = await ingestTelemetry(mockEnv, payload, "org-001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Organization mismatch");
    expect(putFn).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("should generate KV key with organization, device, timestamp, and sensor prefix", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: 1700000000000,
    };

    await ingestTelemetry(mockEnv, payload, "org-001");

    const putCallArgs = putFn.mock.calls[0];
    const kvKey = putCallArgs[0];
    expect(kvKey).toContain("telemetry:");
    expect(kvKey).toContain(":org-001:");
    expect(kvKey).toContain(":dev-001:");
    expect(kvKey).toContain(":1700000000000:");
    expect(kvKey).toContain(":sensor-001");
    // Verify key structure: telemetry:{org}:{device}:{timestamp}:{sensor}
    expect(kvKey).toBe("telemetry:org-001:dev-001:1700000000000:sensor-001");
  });

  it("should write telemetry to KV with 7-day TTL", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    await ingestTelemetry(mockEnv, payload, "org-001");

    const putCallArgs = putFn.mock.calls[0];
    const putValue = putCallArgs[1];
    const putOptions = putCallArgs[2];

    // Verify payload is serialized as JSON
    const parsed = JSON.parse(putValue);
    expect(parsed.organizationId).toBe("org-001");
    expect(parsed.value).toBe(4.2);

    // Verify 7-day TTL in seconds
    expect(putOptions.expirationTtl).toBe(604800);
  });

  it("should store metadata in KV when provided", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
      metadata: {
        location: "cold-room-3",
        batch: "B2025-0423",
        humidityPercent: 65,
      },
    };

    await ingestTelemetry(mockEnv, payload, "org-001");

    const putCallArgs = putFn.mock.calls[0];
    const storedPayload = JSON.parse(putCallArgs[1]);
    expect(storedPayload.metadata).toBeDefined();
    expect(storedPayload.metadata.location).toBe("cold-room-3");
    expect(storedPayload.metadata.batch).toBe("B2025-0423");
  });

  it("should update device status to online and lastSeenAt in D1", async () => {
    const payload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    await ingestTelemetry(mockEnv, payload, "org-001");

    // Verify Drizzle update chain was triggered via mockDb
    expect(mockDb.update).toHaveBeenCalledOnce();

    // Verify set() was called with online status and a Date for lastSeenAt
    expect(mockDb.set).toHaveBeenCalled();
    const setCallArgs = mockDb.set.mock.calls[0][0];
    expect(setCallArgs.status).toBe("online");
    expect(setCallArgs.lastSeenAt).toBeInstanceOf(Date);
  });

  it("should reject telemetry with missing required fields", async () => {
    const payload = {};

    const result = await ingestTelemetry(mockEnv, payload, "org-001");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.telemetryId).toBeUndefined();
  });
});

describe("ingestTelemetryBulk", () => {
  let mockEnv: ReturnType<typeof createMockEnv>["env"];
  let putFn: ReturnType<typeof createMockEnv>["putFn"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDb: any;
  let ingestTelemetryBulk: (env: typeof mockEnv, payloads: unknown[], orgId: string) => Promise<BulkTelemetryIngestResult[]>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const setup = createMockEnv();
    mockEnv = setup.env;
    putFn = setup.putFn;
    mockDb = getDrizzleDb(mockEnv);
    const importedService = await import("../../services/telemetry-ingestion.service");
    ingestTelemetryBulk = importedService.ingestTelemetryBulk;
  });

  it("should accept and store multiple valid telemetry readings", async () => {
    const validPayload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-temperature-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const payloads = [
      { ...validPayload, timestamp: 1700000000001 },
      { ...validPayload, timestamp: 1700000000002 },
      { ...validPayload, timestamp: 1700000000003 },
    ];

    const results = await ingestTelemetryBulk(mockEnv, payloads, "org-001");

    expect(results).toHaveLength(3);
    results.forEach((result, idx) => {
      expect(result.success).toBe(true);
      expect(result.telemetryId).toBeDefined();
      expect(result.telemetryId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.index).toBe(idx);
    });
    expect(putFn).toHaveBeenCalledTimes(3);
  });

  it("should return per-item results for mixed valid and invalid payloads", async () => {
    const validPayload = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-temperature-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const invalidPayload = {
      deviceId: "dev-001",
    };

    const payloads = [
      validPayload,
      invalidPayload,
      { ...validPayload, timestamp: 1700000000005 },
    ];

    const results = await ingestTelemetryBulk(mockEnv, payloads, "org-001");

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].telemetryId).toBeDefined();
    expect(results[0].index).toBe(0);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBeDefined();
    expect(results[1].telemetryId).toBeUndefined();
    expect(results[1].index).toBe(1);
    expect(results[2].success).toBe(true);
    expect(results[2].index).toBe(2);
    expect(putFn).toHaveBeenCalledTimes(2);
  });

  it("should reject all invalid payloads without writing to KV", async () => {
    const payloads = [
      { deviceId: "dev-001" },
      { deviceId: "dev-002" },
      { deviceId: "dev-003" },
    ];

    const results = await ingestTelemetryBulk(mockEnv, payloads, "org-001");

    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result.success).toBe(false);
      expect(result.telemetryId).toBeUndefined();
      expect(result.error).toBeDefined();
    });
    expect(putFn).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("should return empty array with zero side effects for empty input", async () => {
    const results = await ingestTelemetryBulk(mockEnv, [], "org-001");

    expect(results).toEqual([]);
    expect(putFn).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("should batch D1 device updates once per unique deviceId", async () => {
    const validPayloadDeviceOne = {
      organizationId: "org-001",
      deviceId: "dev-001",
      sensorId: "sensor-temperature-001",
      value: 4.2,
      unit: "Celsius",
      timestamp: Date.now(),
    };

    const validPayloadDeviceTwo = {
      organizationId: "org-001",
      deviceId: "dev-002",
      sensorId: "sensor-humidity-001",
      value: 65.0,
      unit: "Percent",
      timestamp: Date.now(),
    };

    const payloads = [
      { ...validPayloadDeviceOne, timestamp: 1700000000001 },
      { ...validPayloadDeviceOne, timestamp: 1700000000002 },
      { ...validPayloadDeviceTwo, timestamp: 1700000000003 },
    ];

    const results = await ingestTelemetryBulk(mockEnv, payloads, "org-001");

    expect(results).toHaveLength(3);
    results.forEach((result) => expect(result.success).toBe(true));
    expect(putFn).toHaveBeenCalledTimes(3);
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });
});