import { eq, and } from "drizzle-orm";
import type { Env } from "../types/env";
import { devices } from "../schema/devices";
import { deviceSensors } from "../schema/device-sensors";
import { deviceCreateValidator, deviceUpdateValidator } from "../validators/device.validator";
import { createDeviceAdapter } from "../adapters/device-adapter.factory";
import { getDrizzleDb } from "../utils/db.util";

export interface DeviceListResult {
  devices: Array<{
    id: string;
    organizationId: string;
    name: string;
    deviceExternalId: string;
    protocolType: string;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    status: string;
    lastSeenAt: Date | null;
    createdAt: Date;
  }>;
  total: number;
}

export interface DeviceResult { device: DeviceListResult["devices"][number] | null }
export interface DeviceCreateResult { success: boolean; device?: DeviceListResult["devices"][number]; error?: string }
export interface DeviceUpdateResult { success: boolean; device?: DeviceListResult["devices"][number]; error?: string }
export interface DeviceDeleteResult { success: boolean; error?: string }

const DEFAULT_DEVICE_SENSORS = [
  { sensorType: "temperature", unit: "Celsius", minThreshold: 0, maxThreshold: 8, isAlertable: true as const },
  { sensorType: "humidity", unit: "percent", minThreshold: 30, maxThreshold: 90, isAlertable: false as const },
  { sensorType: "pressure", unit: "hectopascal", minThreshold: 900, maxThreshold: 1100, isAlertable: false as const },
];

function ownershipCondition(deviceId: string, organizationFilter: string | null) {
  if (organizationFilter === null) return eq(devices.id, deviceId);
  return and(eq(devices.id, deviceId), eq(devices.organizationId, organizationFilter));
}

function formatValidationError(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export async function listDevices(
  env: Env,
  organizationFilter: string | null,
): Promise<DeviceListResult> {
  const query = getDrizzleDb(env).select().from(devices);
  const rows = organizationFilter === null
    ? await query.all()
    : await query.where(eq(devices.organizationId, organizationFilter)).all();
  return { devices: rows, total: rows.length };
}

export async function getDevice(
  env: Env,
  deviceId: string,
  organizationFilter: string | null,
): Promise<DeviceResult> {
  const row = await getDrizzleDb(env).select().from(devices)
    .where(ownershipCondition(deviceId, organizationFilter)).get();
  return { device: row ?? null };
}

export async function createDevice(
  env: Env,
  input: unknown,
  organizationId: string,
): Promise<DeviceCreateResult> {
  const parsed = deviceCreateValidator.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: `Validation failed: ${formatValidationError(parsed.error.issues)}` };
  }
  const data = parsed.data;
  const newDeviceId = crypto.randomUUID();

  const inserted = await getDrizzleDb(env).insert(devices).values({
    id: newDeviceId,
    organizationId,
    name: data.name,
    deviceExternalId: data.deviceExternalId,
    protocolType: data.protocolType,
    location: data.location ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
  }).returning().get();

  for (const s of DEFAULT_DEVICE_SENSORS) {
    await getDrizzleDb(env).insert(deviceSensors).values({
      id: crypto.randomUUID(),
      deviceId: newDeviceId,
      sensorType: s.sensorType,
      unit: s.unit,
      minThreshold: s.minThreshold,
      maxThreshold: s.maxThreshold,
      isAlertable: s.isAlertable,
    }).returning().get();
  }

  const adapter = createDeviceAdapter(data.protocolType);
  await adapter.connect(newDeviceId);
  return { success: true, device: inserted };
}

export async function updateDevice(
  env: Env,
  deviceId: string,
  input: unknown,
  organizationFilter: string | null,
): Promise<DeviceUpdateResult> {
  const parsed = deviceUpdateValidator.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: `Validation failed: ${formatValidationError(parsed.error.issues)}` };
  }
  const updates = parsed.data;
  const existing = await getDrizzleDb(env).select().from(devices)
    .where(ownershipCondition(deviceId, organizationFilter)).get();

  if (!existing) return { success: false, error: "Device not found or access denied" };
  if (Object.keys(updates).length > 0) {
    await getDrizzleDb(env).update(devices).set(updates).where(eq(devices.id, deviceId));
  }
  return { success: true, device: { ...existing, ...updates } };
}

export async function deleteDevice(
  env: Env,
  deviceId: string,
  organizationFilter: string | null,
): Promise<DeviceDeleteResult> {
  const existing = await getDrizzleDb(env).select().from(devices)
    .where(ownershipCondition(deviceId, organizationFilter)).get();

  if (!existing) return { success: false, error: "Device not found or access denied" };

  await getDrizzleDb(env).delete(deviceSensors).where(eq(deviceSensors.deviceId, deviceId));
  await getDrizzleDb(env).delete(devices).where(eq(devices.id, deviceId));

  const adapter = createDeviceAdapter(existing.protocolType);
  await adapter.disconnect(deviceId);
  return { success: true };
}
