import { describe, it, expect } from "vitest";
import { devices, deviceProtocolTypeEnum, deviceStatusEnum } from "../../schema/devices";
import { deviceSensors } from "../../schema/device-sensors";

describe("devices schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(devices);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("deviceExternalId");
    expect(columnNames).toContain("protocolType");
    expect(columnNames).toContain("status");
  });

  it("should have protocolType as enum with tuya and modbus", () => {
    // Drizzle v0.38+: standalone text() enum builders store values in .config.enumValues
    expect(deviceProtocolTypeEnum.config.enumValues).toEqual(["tuya", "modbus"]);
  });

  it("should have organizationId as not null", () => {
    expect(devices.organizationId.notNull).toBe(true);
  });
});

describe("device_sensors schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(deviceSensors);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("deviceId");
    expect(columnNames).toContain("sensorType");
    expect(columnNames).toContain("unit");
    expect(columnNames).toContain("isAlertable");
  });

  it("should have deviceId as not null", () => {
    expect(deviceSensors.deviceId.notNull).toBe(true);
  });
});