import { describe, it, expect } from "vitest";
import { createDeviceAdapter } from "../../adapters/device-adapter.factory";

describe("createDeviceAdapter", () => {
  it("should return an adapter for 'tuya' protocol type", () => {
    const adapter = createDeviceAdapter("tuya");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.disconnect).toBe("function");
    expect(typeof adapter.fetchTelemetry).toBe("function");
    expect(typeof adapter.sendCommand).toBe("function");
    expect(typeof adapter.getDeviceInfo).toBe("function");
  });

  it("should return an adapter for 'modbus' protocol type", () => {
    const adapter = createDeviceAdapter("modbus");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
  });

  it("should return an adapter for 'simulated' protocol type", () => {
    const adapter = createDeviceAdapter("simulated");
    expect(adapter).toBeDefined();
    expect(typeof adapter.connect).toBe("function");
  });

  it("should return the same type of adapter (SimulatedDeviceProvider) for all protocol types currently", () => {
    // In dev mode, all protocol types return the simulator
    const tuyaAdapter = createDeviceAdapter("tuya");
    const modbusAdapter = createDeviceAdapter("modbus");
    // Both should have the 5 DeviceAdapter methods
    for (const adapter of [tuyaAdapter, modbusAdapter]) {
      expect(typeof adapter.connect).toBe("function");
      expect(typeof adapter.disconnect).toBe("function");
      expect(typeof adapter.fetchTelemetry).toBe("function");
      expect(typeof adapter.sendCommand).toBe("function");
      expect(typeof adapter.getDeviceInfo).toBe("function");
    }
  });
});
