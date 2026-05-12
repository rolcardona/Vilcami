import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/device-management.service", () => ({ listDevices: vi.fn() }));
vi.mock("../../adapters/device-adapter.factory", () => ({ createDeviceAdapter: vi.fn() }));
vi.mock("../../services/telemetry-ingestion.service", () => ({ ingestTelemetry: vi.fn() }));

import { collectTelemetryFromAllDevices } from "../../services/device-collection-cron.service";
import { listDevices } from "../../services/device-management.service";
import { createDeviceAdapter } from "../../adapters/device-adapter.factory";
import { ingestTelemetry } from "../../services/telemetry-ingestion.service";
import type { Env } from "../../types/env";
import type { DeviceAdapter, DeviceTelemetry } from "../../adapters/device-adapter.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(readings: DeviceTelemetry[]): DeviceAdapter {
  return {
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    fetchTelemetry: vi.fn().mockResolvedValue(readings),
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    getDeviceInfo: vi.fn().mockResolvedValue({ deviceId: "dev-001", protocolType: "simulated", status: "online", sensors: [] }),
  } as unknown as DeviceAdapter;
}

function buildTelemetryReading(overrides?: Partial<DeviceTelemetry>): DeviceTelemetry {
  return {
    deviceId: "dev-001", sensorId: "dev-001:temp-001", value: 4.2, unit: "Celsius",
    timestamp: 1700000000000, metadata: { sensorType: "temperature" }, ...overrides,
  };
}

function buildTestEnv(): Env {
  return { DB: {} as D1Database, TELEMETRY_RAW: {} as KVNamespace, SECRETS_VAULT: {} as KVNamespace, THROTTLE_KV: {} as KVNamespace, ENCRYPTION_KEY: "test-key", SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_ANON_KEY: "test-anon-key", WOMPI_BASE_URL: "https://sandbox.wompi.co/v1", WOMPI_PUBLIC_KEY: "test-pub-key", WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key", AI: { run: vi.fn() } as unknown as Ai } as Env;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectTelemetryFromAllDevices", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = buildTestEnv();
  });

  it("deberia retornar array vacio cuando no existen dispositivos", async () => {
    vi.mocked(listDevices).mockResolvedValue({ devices: [], total: 0 });

    const results = await collectTelemetryFromAllDevices(mockEnv);

    expect(results).toEqual([]);
    expect(listDevices).toHaveBeenCalledWith(mockEnv, null);
  });

  it("deberia colectar telemetria de todos los dispositivos y retornar estadisticas por dispositivo", async () => {
    const mockAdapter = createMockAdapter([buildTelemetryReading()]);
    vi.mocked(listDevices).mockResolvedValue({
      devices: [
        { id: "dev-001", organizationId: "org-001", protocolType: "simulated" },
        { id: "dev-002", organizationId: "org-001", protocolType: "simulated" },
      ] as any,
      total: 2,
    });
    vi.mocked(createDeviceAdapter).mockReturnValue(mockAdapter);
    vi.mocked(ingestTelemetry).mockResolvedValue({ success: true, telemetryId: "tel-001" });

    const results = await collectTelemetryFromAllDevices(mockEnv);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ deviceId: "dev-001", organizationId: "org-001", telemetryCount: 1, successCount: 1, failureCount: 0 });
    expect(results[1].deviceId).toBe("dev-002");
    expect(ingestTelemetry).toHaveBeenCalledTimes(2);
  });

  it("deberia enriquecer cada lectura con organizationId y pasarlo como jwtOrganizationId", async () => {
    const mockAdapter = createMockAdapter([buildTelemetryReading()]);
    vi.mocked(listDevices).mockResolvedValue({
      devices: [{ id: "dev-001", organizationId: "org-042", protocolType: "simulated" }] as any, total: 1,
    });
    vi.mocked(createDeviceAdapter).mockReturnValue(mockAdapter);
    vi.mocked(ingestTelemetry).mockResolvedValue({ success: true, telemetryId: "tel-001" });

    await collectTelemetryFromAllDevices(mockEnv);

    const payloadArg = vi.mocked(ingestTelemetry).mock.calls[0][1] as Record<string, unknown>;
    const jwtOrgArg = vi.mocked(ingestTelemetry).mock.calls[0][2];
    expect(payloadArg.organizationId).toBe("org-042");
    expect(payloadArg.deviceId).toBe("dev-001");
    expect(payloadArg.value).toBe(4.2);
    expect(jwtOrgArg).toBe("org-042");
  });

  it("deberia omitir gracefulmente dispositivos cuyo fetchTelemetry lanza error", async () => {
    const failingAdapter: DeviceAdapter = {
      connect: vi.fn().mockResolvedValue({ success: true }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      fetchTelemetry: vi.fn().mockRejectedValue(new Error("Connection timeout")),
      sendCommand: vi.fn(), getDeviceInfo: vi.fn(),
    } as unknown as DeviceAdapter;
    const healthyAdapter = createMockAdapter([buildTelemetryReading()]);

    vi.mocked(listDevices).mockResolvedValue({
      devices: [
        { id: "dev-bad", organizationId: "org-001", protocolType: "simulated" },
        { id: "dev-good", organizationId: "org-001", protocolType: "simulated" },
      ] as any, total: 2,
    });
    vi.mocked(createDeviceAdapter).mockReturnValueOnce(failingAdapter).mockReturnValueOnce(healthyAdapter);
    vi.mocked(ingestTelemetry).mockResolvedValue({ success: true, telemetryId: "tel-001" });

    const results = await collectTelemetryFromAllDevices(mockEnv);

    expect(results).toHaveLength(2);
    const badResult = results.find((r) => r.deviceId === "dev-bad")!;
    expect(badResult.telemetryCount).toBe(0);
    const goodResult = results.find((r) => r.deviceId === "dev-good")!;
    expect(goodResult.telemetryCount).toBe(1);
    expect(ingestTelemetry).toHaveBeenCalledTimes(1);
  });

  it("deberia manejar combinacion de ingestiones exitosas y fallidas para un mismo dispositivo", async () => {
    const threeReadings = [
      buildTelemetryReading({ sensorId: "dev-001:temp-001", value: 1.0 }),
      buildTelemetryReading({ sensorId: "dev-001:hum-001", value: 65.0 }),
      buildTelemetryReading({ sensorId: "dev-001:press-001", value: 1013.0 }),
    ];
    vi.mocked(listDevices).mockResolvedValue({
      devices: [{ id: "dev-001", organizationId: "org-001", protocolType: "simulated" }] as any, total: 1,
    });
    vi.mocked(createDeviceAdapter).mockReturnValue(createMockAdapter(threeReadings));
    vi.mocked(ingestTelemetry)
      .mockResolvedValueOnce({ success: true, telemetryId: "tel-001" })
      .mockResolvedValueOnce({ success: false, error: "Validation failed" })
      .mockResolvedValueOnce({ success: true, telemetryId: "tel-003" });

    const results = await collectTelemetryFromAllDevices(mockEnv);

    expect(results).toHaveLength(1);
    expect(results[0].telemetryCount).toBe(3);
    expect(results[0].successCount).toBe(2);
    expect(results[0].failureCount).toBe(1);
  });

  it("deberia conectar cada dispositivo antes de obtener telemetria (inicializacion de estado)", async () => {
    const mockAdapter = createMockAdapter([buildTelemetryReading()]);
    vi.mocked(listDevices).mockResolvedValue({
      devices: [{ id: "dev-001", organizationId: "org-001", protocolType: "simulated" }] as any, total: 1,
    });
    vi.mocked(createDeviceAdapter).mockReturnValue(mockAdapter);
    vi.mocked(ingestTelemetry).mockResolvedValue({ success: true });

    await collectTelemetryFromAllDevices(mockEnv);

    expect(mockAdapter.connect).toHaveBeenCalledWith("dev-001");
    const connectOrder = (mockAdapter.connect as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const fetchOrder = (mockAdapter.fetchTelemetry as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(connectOrder).toBeLessThan(fetchOrder);
  });

  it("deberia manejar dispositivos con distinta cantidad de sensores", async () => {
    const adapterOne = createMockAdapter([buildTelemetryReading()]);
    const adapterTwo = createMockAdapter([
      buildTelemetryReading({ sensorId: "dev-002:temp-001" }),
      buildTelemetryReading({ sensorId: "dev-002:hum-001", value: 70.0 }),
      buildTelemetryReading({ sensorId: "dev-002:press-001", value: 1015.0 }),
    ]);
    vi.mocked(listDevices).mockResolvedValue({
      devices: [
        { id: "dev-001", organizationId: "org-001", protocolType: "simulated" },
        { id: "dev-002", organizationId: "org-002", protocolType: "simulated" },
      ] as any, total: 2,
    });
    vi.mocked(createDeviceAdapter).mockReturnValueOnce(adapterOne).mockReturnValueOnce(adapterTwo);
    vi.mocked(ingestTelemetry).mockResolvedValue({ success: true, telemetryId: "tel-id" });

    const results = await collectTelemetryFromAllDevices(mockEnv);

    expect(results).toHaveLength(2);
    expect(results[0].telemetryCount).toBe(1);
    expect(results[1].telemetryCount).toBe(3);
    expect(ingestTelemetry).toHaveBeenCalledTimes(4);
  });
});
