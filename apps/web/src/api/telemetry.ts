import { api } from "./client";

export interface TelemetryReading {
  deviceId: string;
  sensorId: string;
  value: number;
  unit: string;
  timestamp: string;
}

export const telemetryApi = {
  getRecent: (deviceId: string, limit = 20) =>
    api.get(`telemetry/${deviceId}`, { searchParams: { limit: String(limit) } }).json<TelemetryReading[]>(),
  ingest: (data: Omit<TelemetryReading, "timestamp">) =>
    api.post("telemetry/ingest", { json: data }).json<{ ok: boolean }>(),
  ingestBulk: (data: Omit<TelemetryReading, "timestamp">[]) =>
    api.post("telemetry/ingest/bulk", { json: data }).json<{ ok: boolean }>(),
};