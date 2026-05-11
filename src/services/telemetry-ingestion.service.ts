import { telemetryValidator } from "../validators/telemetry.validator";
import { devices } from "../schema/devices";
import { eq, and } from "drizzle-orm";
import type { Env } from "../types/env";
import { getDrizzleDb } from "../utils/db.util";

export interface TelemetryIngestResult {
  success: boolean;
  telemetryId?: string;
  error?: string;
}

/**
 * Validates and stores a single telemetry reading from an IoT sensor.
 *
 * Processing flow:
 *  1. Validate payload shape with telemetryValidator.safeParse()
 *  2. Verify organizationId matches the authenticated context (cross-org injection guard)
 *  3. Generate a collision-resistant KV key and persist to TELEMETRY_RAW with 7-day TTL
 *  4. Set the device status to 'online' and update lastSeenAt in D1
 *
 * Security invariants:
 *  - Every D1 write is scoped with eq(devices.organizationId, jwtOrganizationId)
 *  - Payload organizationId MUST match the JWT-bound organization context
 */
export async function ingestTelemetry(
  env: Env,
  payload: unknown,
  jwtOrganizationId: string,
): Promise<TelemetryIngestResult> {
  const validationResult = telemetryValidator.safeParse(payload);

  if (!validationResult.success) {
    const formattedErrors = validationResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return {
      success: false,
      error: `Validation failed: ${formattedErrors}`,
    };
  }

  const sensorReading = validationResult.data;

  // Cross-organization injection guard: the payload org MUST match the JWT org
  if (sensorReading.organizationId !== jwtOrganizationId) {
    return {
      success: false,
      error: "Organization mismatch: payload organizationId does not match authenticated context",
    };
  }

  const uniqueTelemetryId = crypto.randomUUID();
  const kvStorageKey =
    `telemetry:${sensorReading.organizationId}:${sensorReading.deviceId}:${sensorReading.timestamp}:${sensorReading.sensorId}`;

  // Persist raw telemetry to KV with 7-day retention window
  await env.TELEMETRY_RAW.put(kvStorageKey, JSON.stringify(sensorReading), {
    expirationTtl: 604800, // 7 days in seconds
  });

  // Side-effect: mark device as online and touch lastSeenAt
  await getDrizzleDb(env).update(devices)
    .set({
      status: "online",
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(devices.id, sensorReading.deviceId),
        eq(devices.organizationId, sensorReading.organizationId),
      ),
    );

  return {
    success: true,
    telemetryId: uniqueTelemetryId,
  };
}

export interface BulkTelemetryIngestResult {
  success: boolean;
  telemetryId?: string;
  error?: string;
  index: number;
}

/**
 * Validates and stores multiple telemetry readings in batch.
 *
 * Uses sequential validation with batched D1 writes. Returns per-item results
 * so callers can identify which entries succeeded and which failed.
 * D1 device updates are batched: one update per unique deviceId.
 */
export async function ingestTelemetryBulk(
  env: Env,
  payloads: unknown[],
  jwtOrganizationId: string,
): Promise<BulkTelemetryIngestResult[]> {
  const results: BulkTelemetryIngestResult[] = [];
  const deviceIdsToUpdate = new Set<string>();

  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index];
    const validationResult = telemetryValidator.safeParse(payload);

    if (!validationResult.success) {
      const formattedErrors = validationResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      results.push({
        success: false,
        error: `Validation failed: ${formattedErrors}`,
        index,
      });
      continue;
    }

    const sensorReading = validationResult.data;

    if (sensorReading.organizationId !== jwtOrganizationId) {
      results.push({
        success: false,
        error: "Organization mismatch: payload organizationId does not match authenticated context",
        index,
      });
      continue;
    }

    const uniqueTelemetryId = crypto.randomUUID();
    const kvStorageKey =
      `telemetry:${sensorReading.organizationId}:${sensorReading.deviceId}:${sensorReading.timestamp}:${sensorReading.sensorId}`;

    await env.TELEMETRY_RAW.put(kvStorageKey, JSON.stringify(sensorReading), {
      expirationTtl: 604800,
    });

    deviceIdsToUpdate.add(sensorReading.deviceId);

    results.push({
      success: true,
      telemetryId: uniqueTelemetryId,
      index,
    });
  }

  for (const deviceId of deviceIdsToUpdate) {
    await getDrizzleDb(env).update(devices)
      .set({
        status: "online",
        lastSeenAt: new Date(),
      })
      .where(
        and(
          eq(devices.id, deviceId),
          eq(devices.organizationId, jwtOrganizationId),
        ),
      );
  }

  return results;
}
