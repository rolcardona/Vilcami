import { describe, it, expect } from "vitest";
import * as deviceAdapterModule from "../../adapters/device-adapter.interface";

describe("DeviceAdapter Interface", () => {
	it("should export the module from the adapters directory", () => {
		expect(deviceAdapterModule).toBeDefined();
	});

	it("should export the DeviceConnectionResult type (compile-time duck-type check)", () => {
		const result: deviceAdapterModule.DeviceConnectionResult = {
			success: true,
			deviceInfo: {
				deviceId: "dev-001",
				protocolType: "tuya",
				status: "online",
				sensors: [],
			},
		};
		expect(result.success).toBe(true);
	});

	it("should export the DeviceTelemetry type (compile-time duck-type check)", () => {
		const telemetry: deviceAdapterModule.DeviceTelemetry = {
			deviceId: "dev-001",
			sensorId: "sensor-temp-01",
			value: 23.5,
			unit: "Celsius",
			timestamp: Date.now(),
		};
		expect(telemetry.value).toBe(23.5);
	});

	it("should export the DeviceCommandResult type (compile-time duck-type check)", () => {
		const cmdResult: deviceAdapterModule.DeviceCommandResult = {
			success: true,
			payload: { setpointCelsius: -18 },
		};
		expect(cmdResult.success).toBe(true);
	});

	it("should allow an object literal to satisfy the DeviceAdapter shape (5 required methods)", () => {
		const mockAdapter: deviceAdapterModule.DeviceAdapter = {
			connect: async (_deviceId: string, _credentials?: Record<string, unknown>) => ({
				success: true,
			}),
			disconnect: async (_deviceId: string) => {},
			fetchTelemetry: async (_deviceId: string, _sensorIds?: string[]) => [],
			sendCommand: async (_deviceId: string, _command: deviceAdapterModule.DeviceCommand) => ({
				success: true,
			}),
			getDeviceInfo: async (_deviceId: string) => ({
				deviceId: _deviceId,
				protocolType: "tuya",
				status: "online",
				sensors: [],
			}),
		};

		// Verify all 5 method names exist on the object
		const methodNames = Object.keys(mockAdapter);
		expect(methodNames).toContain("connect");
		expect(methodNames).toContain("disconnect");
		expect(methodNames).toContain("fetchTelemetry");
		expect(methodNames).toContain("sendCommand");
		expect(methodNames).toContain("getDeviceInfo");
		expect(methodNames.length).toBe(5);
	});
});
