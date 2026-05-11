import type { Env } from "../types/env";
import { listDevices } from "./device-management.service";
import { createDeviceAdapter } from "../adapters/device-adapter.factory";
import { ingestTelemetry } from "./telemetry-ingestion.service";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface DeviceCollectionResult {
  deviceId: string;
  organizationId: string;
  telemetryCount: number;
  successCount: number;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

/**
 * Colecta telemetria de TODOS los dispositivos conectados (todas las
 * organizaciones) y alimenta cada lectura en el pipeline estandar de
 * ingestion (validacion Zod → KV raw → D1 update de estado).
 *
 * Este es el puente entre los dispositivos simulados (estado en memoria)
 * y la capa de almacenamiento persistente (KV + D1).
 *
 * Diseniado para ejecutarse periodicamente (cada 5 minutos o como parte
 * de un cron horario) cerrando el lazo de datos.
 *
 * Flujo:
 *  1. Listar todos los dispositivos (scope admin — filtro null = todas las orgs)
 *  2. Por cada dispositivo: connect() → fetchTelemetry() via el adaptador de protocolo
 *  3. Cada lectura se envia a ingestTelemetry() → validacion + KV + D1
 *  4. Retorna estadisticas de coleccion por dispositivo
 *
 * Seguridad:
 *  - El organizationId del payload DEBE coincidir con el del dispositivo
 *  - ingestTelemetry aplica su propia validacion cross-org (doble chequeo)
 */
export async function collectTelemetryFromAllDevices(
  env: Env,
): Promise<DeviceCollectionResult[]> {
  const { devices: allDevices } = await listDevices(env, null);

  if (allDevices.length === 0) {
    return [];
  }

  const collectionResults: DeviceCollectionResult[] = [];

  for (const device of allDevices) {
    let successCount = 0;
    let failureCount = 0;

    try {
      const protocolAdapter = createDeviceAdapter(device.protocolType as "tuya" | "modbus" | "simulated");

      // Inicializar estado del dispositivo simulado (factory crea instancia nueva —
      // sin connect() el dispositivo no tiene sensores en memoria y fetchTelemetry
      // retorna []).
      await protocolAdapter.connect(device.id);

      const telemetryReadings = await protocolAdapter.fetchTelemetry(device.id);

      for (const reading of telemetryReadings) {
        const enrichedPayload = {
          organizationId: device.organizationId,
          deviceId: reading.deviceId,
          sensorId: reading.sensorId,
          value: reading.value,
          unit: reading.unit,
          timestamp: reading.timestamp,
          metadata: reading.metadata,
        };

        const ingestionResult = await ingestTelemetry(
          env,
          enrichedPayload,
          device.organizationId,
        );

        if (ingestionResult.success) {
          successCount++;
        } else {
          failureCount++;
        }
      }
    } catch {
      // Dispositivo desconectado, sin estado, o error de red — omitir
      // gracefully sin detener la coleccion de los demas dispositivos.
    }

    collectionResults.push({
      deviceId: device.id,
      organizationId: device.organizationId,
      telemetryCount: successCount + failureCount,
      successCount,
      failureCount,
    });
  }

  return collectionResults;
}
