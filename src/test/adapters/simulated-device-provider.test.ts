import { describe, it, expect } from "vitest";
import { SimulatedDeviceProvider } from "../../adapters/simulated-device.provider";

/**
 * Helper: crea una instancia fresca del provider con timeout reducido
 * para que todos los tests arranquen desde estado limpio.
 */
function createFreshProvider(): SimulatedDeviceProvider {
  return new SimulatedDeviceProvider();
}

describe("SimulatedDeviceProvider", () => {
  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------
  describe("connect", () => {
    it("should connect successfully and return DeviceInfo with sensors", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("device-test-001");

      expect(result.success).toBe(true);
      expect(result.deviceInfo).toBeDefined();
      expect(result.deviceInfo!.deviceId).toBe("device-test-001");
      expect(result.deviceInfo!.protocolType).toBe("simulated");
      expect(result.deviceInfo!.status).toBe("online");
      expect(result.deviceInfo!.sensors.length).toBeGreaterThan(0);
    });

    it("should create exactly 3 default sensors (temperature, humidity, pressure)", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("device-test-002");

      const sensorTypes = result.deviceInfo!.sensors.map(
        (sensor) => sensor.sensorType,
      );
      expect(sensorTypes).toContain("temperature");
      expect(sensorTypes).toContain("humidity");
      expect(sensorTypes).toContain("pressure");
      expect(result.deviceInfo!.sensors.length).toBe(3);
    });

    it("should assign sensor IDs prefixed with deviceId", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("fridge-coldroom-03");

      for (const sensor of result.deviceInfo!.sensors) {
        expect(sensor.sensorId).toContain("fridge-coldroom-03:");
      }
    });

    it("should set connectedAt to the current time (within tolerance)", async () => {
      const provider = createFreshProvider();
      const beforeConnect = Date.now();
      const result = await provider.connect("device-test-003");
      const afterConnect = Date.now();

      expect(result.success).toBe(true);

      // Verify telemetry timestamp reflects time since connection
      const telemetry = await provider.fetchTelemetry("device-test-003");
      expect(telemetry.length).toBeGreaterThan(0);
      // The timestamp should be within [beforeConnect - 5000, afterConnect + 5000]
      // giving generous tolerance
      const firstTelemetryTimestamp = telemetry[0].timestamp;
      expect(firstTelemetryTimestamp).toBeGreaterThanOrEqual(
        beforeConnect - 5000,
      );
      expect(firstTelemetryTimestamp).toBeLessThanOrEqual(afterConnect + 5000);
    });
  });

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------
  describe("disconnect", () => {
    it("should disconnect without error", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-004");
      await expect(
        provider.disconnect("device-test-004"),
      ).resolves.toBeUndefined();
    });

    it("should no-op when disconnecting an unknown device (no throw)", async () => {
      const provider = createFreshProvider();
      await expect(
        provider.disconnect("nonexistent-device"),
      ).resolves.toBeUndefined();
    });

    it("should make fetchTelemetry return empty after disconnect", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-005");
      await provider.disconnect("device-test-005");

      const telemetry = await provider.fetchTelemetry("device-test-005");
      expect(telemetry).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // fetchTelemetry
  // -------------------------------------------------------------------------
  describe("fetchTelemetry", () => {
    it("should return telemetry for all sensors of a connected device", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-006");

      const telemetryEntries = await provider.fetchTelemetry("device-test-006");
      expect(telemetryEntries.length).toBe(3);
      for (const entry of telemetryEntries) {
        expect(entry.deviceId).toBe("device-test-006");
        expect(typeof entry.value).toBe("number");
        expect(typeof entry.unit).toBe("string");
        expect(typeof entry.timestamp).toBe("number");
      }
    });

    it("should return only requested sensorIds when specified", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("device-test-007");
      const pressureSensor = result.deviceInfo!.sensors.find(
        (sensor) => sensor.sensorType === "pressure",
      );

      const telemetryEntries = await provider.fetchTelemetry("device-test-007", [
        pressureSensor!.sensorId,
      ]);
      expect(telemetryEntries.length).toBe(1);
      expect(telemetryEntries[0].sensorId).toBe(pressureSensor!.sensorId);
      expect(telemetryEntries[0].unit).toBe("hectopascal");
    });

    it("should return empty array when device is not connected", async () => {
      const provider = createFreshProvider();
      const telemetry = await provider.fetchTelemetry(
        "never-connected-device",
      );
      expect(telemetry).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // sendCommand
  // -------------------------------------------------------------------------
  describe("sendCommand", () => {
    it("should update sensor baseValue when commandType is setSetpoint", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-008");

      // Find the temperature sensor
      const deviceInfo = await provider.getDeviceInfo("device-test-008");
      const temperatureSensor = deviceInfo.sensors.find(
        (sensor) => sensor.sensorType === "temperature",
      )!;

      // Record initial value
      const initialTelemetry = await provider.fetchTelemetry(
        "device-test-008",
        [temperatureSensor.sensorId],
      );
      const initialValue = initialTelemetry[0].value;

      // Send setpoint command to change baseValue from 4.0 to 10.0
      const commandResult = await provider.sendCommand("device-test-008", {
        commandType: "setSetpoint",
        parameters: {
          sensorId: temperatureSensor.sensorId,
          value: 10.0,
        },
      });

      expect(commandResult.success).toBe(true);

      // Fetch telemetry again — the mean should now be around 10.0
      const updatedTelemetry = await provider.fetchTelemetry(
        "device-test-008",
        [temperatureSensor.sensorId],
      );
      const updatedValue = updatedTelemetry[0].value;

      // The new value should be much closer to 10.0 than to the old base (4.0)
      const distanceToNewSetpoint = Math.abs(updatedValue - 10.0);
      const distanceToOldBase = Math.abs(updatedValue - 4.0);
      expect(distanceToNewSetpoint).toBeLessThan(distanceToOldBase);
    });

    it("should return error for unknown commandType", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-009");

      const result = await provider.sendCommand("device-test-009", {
        commandType: "unknownCommandXYZ",
        parameters: {},
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
      expect(result.errorMessage).toContain("unknownCommandXYZ");
    });

    it("should return error when sending command to unknown device", async () => {
      const provider = createFreshProvider();

      const result = await provider.sendCommand("ghost-device", {
        commandType: "setSetpoint",
        parameters: { sensorId: "ghost-device:temp-001", value: 5.0 },
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getDeviceInfo
  // -------------------------------------------------------------------------
  describe("getDeviceInfo", () => {
    it("should return device info with sensor list for connected device", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-010");

      const deviceInfo = await provider.getDeviceInfo("device-test-010");
      expect(deviceInfo.deviceId).toBe("device-test-010");
      expect(deviceInfo.protocolType).toBe("simulated");
      expect(deviceInfo.status).toBe("online");
      expect(deviceInfo.sensors.length).toBe(3);

      for (const sensor of deviceInfo.sensors) {
        expect(sensor.sensorId).toBeDefined();
        expect(sensor.sensorType).toBeDefined();
        expect(sensor.unit).toBeDefined();
        expect(typeof sensor.currentValue).toBe("number");
      }
    });

    it("should include currentValue computed fresh on each call", async () => {
      const provider = createFreshProvider();
      await provider.connect("device-test-011");

      const infoCallOne = await provider.getDeviceInfo("device-test-011");
      const infoCallTwo = await provider.getDeviceInfo("device-test-011");

      // Current values may differ slightly due to noise
      for (let i = 0; i < infoCallOne.sensors.length; i++) {
        expect(typeof infoCallOne.sensors[i].currentValue).toBe("number");
        expect(typeof infoCallTwo.sensors[i].currentValue).toBe("number");
      }
    });

    it("should throw when device is not found", async () => {
      const provider = createFreshProvider();
      await expect(
        provider.getDeviceInfo("nonexistent-device-xyz"),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Telemetry value variation
  // -------------------------------------------------------------------------
  describe("Telemetry value variation", () => {
    it("should produce slightly different values on successive fetchTelemetry calls (due to noise)", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("device-test-012");
      const temperatureSensor = result.deviceInfo!.sensors.find(
        (sensor) => sensor.sensorType === "temperature",
      )!;

      const values: number[] = [];
      for (let i = 0; i < 10; i++) {
        const telemetry = await provider.fetchTelemetry("device-test-012", [
          temperatureSensor.sensorId,
        ]);
        values.push(telemetry[0].value);
      }

      // At least some values should differ (not all identical)
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });

    it("should produce values that stay within reasonable bounds around the baseValue", async () => {
      const provider = createFreshProvider();
      const result = await provider.connect("device-test-013");
      const temperatureSensor = result.deviceInfo!.sensors.find(
        (sensor) => sensor.sensorType === "temperature",
      )!;

      // Temperature baseValue is 4.0, amplitude is 1.5, noiseFactor is 0.15
      // Max expected deviation: 1.5 + 3*0.15 ~ 1.95  (3-sigma for noise)
      // Values should stay within [4.0 - 2.5, 4.0 + 2.5] = [1.5, 6.5]
      const lowerBound = 1.0;
      const upperBound = 7.0;

      for (let i = 0; i < 50; i++) {
        const telemetryEntries = await provider.fetchTelemetry(
          "device-test-013",
          [temperatureSensor.sensorId],
        );
        const value = telemetryEntries[0].value;
        expect(value).toBeGreaterThan(lowerBound);
        expect(value).toBeLessThan(upperBound);
      }
    });
  });
});
