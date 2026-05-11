/**
 * SimulatedDeviceProvider — Adaptador IoT simulado para desarrollo y testing.
 * Genera telemetria sintetica via funcion senoidal + ruido Gaussiano (Box-Muller).
 * No requiere hardware real. Sustituto de Tuya/Modbus en Phase 2.
 */
import { generateGaussianNoise } from "../utils/gaussian-noise.util";
import type {
  DeviceAdapter,
  DeviceCommand,
  DeviceCommandResult,
  DeviceConnectionResult,
  DeviceInfo,
  DeviceTelemetry,
  SensorInfo,
} from "./device-adapter.interface";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface SimulatedSensorConfig {
  sensorId: string;
  sensorType: string;
  unit: string;
  baseValue: number;
  amplitude: number;
  periodSeconds: number;
  noiseFactor: number;
}

interface SimulatedDeviceState {
  deviceId: string;
  protocolType: string;
  status: string;
  connectedAt: number;
  sensors: Map<string, SimulatedSensorConfig>;
}

// ---------------------------------------------------------------------------
// Plantillas de sensores por defecto
// ---------------------------------------------------------------------------

const DEFAULT_SENSOR_DEFINITIONS: Array<{
  sensorLocalId: string;
  sensorType: string;
  unit: string;
  baseValue: number;
  amplitude: number;
  periodSeconds: number;
  noiseFactor: number;
}> = [
  { sensorLocalId: "temp-001", sensorType: "temperature", unit: "Celsius", baseValue: 4.0, amplitude: 1.5, periodSeconds: 300, noiseFactor: 0.15 },
  { sensorLocalId: "hum-001", sensorType: "humidity", unit: "percent", baseValue: 65.0, amplitude: 5.0, periodSeconds: 600, noiseFactor: 0.1 },
  { sensorLocalId: "press-001", sensorType: "pressure", unit: "hectopascal", baseValue: 1013.25, amplitude: 3.0, periodSeconds: 900, noiseFactor: 0.08 },
];

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

function computeSensorValue(config: SimulatedSensorConfig, elapsedSeconds: number): number {
  const sineComponent = config.amplitude * Math.sin((2.0 * Math.PI * elapsedSeconds) / config.periodSeconds);
  const noiseComponent = config.noiseFactor * generateGaussianNoise();
  return config.baseValue + sineComponent + noiseComponent;
}

function toSensorInfo(config: SimulatedSensorConfig, connectedAt: number): SensorInfo {
  return {
    sensorId: config.sensorId,
    sensorType: config.sensorType,
    unit: config.unit,
    currentValue: computeSensorValue(config, (Date.now() - connectedAt) / 1000),
  };
}

function toDeviceTelemetry(deviceId: string, config: SimulatedSensorConfig, connectedAt: number): DeviceTelemetry {
  return {
    deviceId,
    sensorId: config.sensorId,
    value: computeSensorValue(config, (Date.now() - connectedAt) / 1000),
    unit: config.unit,
    timestamp: Date.now(),
    metadata: { sensorType: config.sensorType },
  };
}

function buildSensorMap(deviceId: string): Map<string, SimulatedSensorConfig> {
  const sensorMap = new Map<string, SimulatedSensorConfig>();
  for (const def of DEFAULT_SENSOR_DEFINITIONS) {
    const prefixedId = `${deviceId}:${def.sensorLocalId}`;
    sensorMap.set(prefixedId, {
      sensorId: prefixedId,
      sensorType: def.sensorType,
      unit: def.unit,
      baseValue: def.baseValue,
      amplitude: def.amplitude,
      periodSeconds: def.periodSeconds,
      noiseFactor: def.noiseFactor,
    });
  }
  return sensorMap;
}

// ---------------------------------------------------------------------------
// SimulatedDeviceProvider
// ---------------------------------------------------------------------------

export class SimulatedDeviceProvider implements DeviceAdapter {
  private readonly deviceStates = new Map<string, SimulatedDeviceState>();

  async connect(deviceId: string, _credentials?: Record<string, unknown>): Promise<DeviceConnectionResult> {
    const sensorMap = buildSensorMap(deviceId);
    const deviceState: SimulatedDeviceState = {
      deviceId,
      protocolType: "simulated",
      status: "online",
      connectedAt: Date.now(),
      sensors: sensorMap,
    };
    this.deviceStates.set(deviceId, deviceState);
    return { success: true, deviceInfo: this.buildDeviceInfo(deviceState) };
  }

  async disconnect(deviceId: string): Promise<void> {
    this.deviceStates.delete(deviceId);
  }

  async fetchTelemetry(deviceId: string, sensorIds?: string[]): Promise<DeviceTelemetry[]> {
    const deviceState = this.deviceStates.get(deviceId);
    if (!deviceState) return [];

    const targetSensorIds = sensorIds ?? Array.from(deviceState.sensors.keys());
    const telemetryEntries: DeviceTelemetry[] = [];

    for (const sensorId of targetSensorIds) {
      const sensorConfig = deviceState.sensors.get(sensorId);
      if (sensorConfig) {
        telemetryEntries.push(toDeviceTelemetry(deviceId, sensorConfig, deviceState.connectedAt));
      }
    }
    return telemetryEntries;
  }

  async sendCommand(deviceId: string, command: DeviceCommand): Promise<DeviceCommandResult> {
    const deviceState = this.deviceStates.get(deviceId);
    if (!deviceState) {
      return { success: false, errorMessage: `Device not found: ${deviceId}` };
    }

    if (command.commandType !== "setSetpoint") {
      return { success: false, errorMessage: `Unknown command type: ${command.commandType}` };
    }

    const targetSensorId = command.parameters.sensorId as string | undefined;
    const newBaseValue = command.parameters.value as number | undefined;

    if (!targetSensorId || typeof newBaseValue !== "number") {
      return {
        success: false,
        errorMessage: "setSetpoint requires parameters: sensorId (string) and value (number)",
      };
    }

    const sensorConfig = deviceState.sensors.get(targetSensorId);
    if (!sensorConfig) {
      return { success: false, errorMessage: `Sensor not found: ${targetSensorId}` };
    }

    sensorConfig.baseValue = newBaseValue;
    return { success: true };
  }

  async getDeviceInfo(deviceId: string): Promise<DeviceInfo> {
    const deviceState = this.deviceStates.get(deviceId);
    if (!deviceState) {
      throw new Error(`Device not found: ${deviceId}`);
    }
    return this.buildDeviceInfo(deviceState);
  }

  // -----------------------------------------------------------------------
  // Privados
  // -----------------------------------------------------------------------

  private buildDeviceInfo(deviceState: SimulatedDeviceState): DeviceInfo {
    const sensorInfoList: SensorInfo[] = [];
    for (const sensorConfig of deviceState.sensors.values()) {
      sensorInfoList.push(toSensorInfo(sensorConfig, deviceState.connectedAt));
    }
    return {
      deviceId: deviceState.deviceId,
      protocolType: deviceState.protocolType,
      status: deviceState.status,
      sensors: sensorInfoList,
    };
  }
}
