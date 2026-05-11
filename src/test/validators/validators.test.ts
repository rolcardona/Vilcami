import { describe, it, expect } from "vitest";
import { telemetryValidator } from "../../validators/telemetry.validator";
import { deviceValidator, deviceCreateValidator, deviceUpdateValidator } from "../../validators/device.validator";
import { alertRuleValidator } from "../../validators/alert.validator";
import { billingEventValidator } from "../../validators/billing.validator";
import { complianceTemplateValidator } from "../../validators/compliance.validator";

describe("telemetryValidator", () => {
  it("should accept valid telemetry data", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing organizationId", () => {
    const result = telemetryValidator.safeParse({
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-numeric value", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: "hot",
      unit: "°C",
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it("should reject zero timestamp (must be positive)", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative timestamp", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: -1,
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid optional metadata", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: Date.now(),
      metadata: { location: "cold-room-3", batch: "B2025" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual({ location: "cold-room-3", batch: "B2025" });
    }
  });

  it("should reject non-integer timestamp (float)", () => {
    const result = telemetryValidator.safeParse({
      organizationId: "org-123",
      deviceId: "dev-456",
      sensorId: "sensor-789",
      value: 23.5,
      unit: "°C",
      timestamp: 1700000000.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("deviceValidator", () => {
  it("should accept valid device data", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      location: "Planta Baja",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid protocolType", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "zigbee",
    });
    expect(result.success).toBe(false);
  });

  it("should reject latitude above 90", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      latitude: 91,
    });
    expect(result.success).toBe(false);
  });

  it("should reject latitude below -90", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      latitude: -91,
    });
    expect(result.success).toBe(false);
  });

  it("should reject longitude above 180", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      longitude: 181,
    });
    expect(result.success).toBe(false);
  });

  it("should reject longitude below -180", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      longitude: -181,
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid latitude and longitude bounds", () => {
    const result = deviceValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      latitude: -34.6037,
      longitude: -58.3816,
    });
    expect(result.success).toBe(true);
  });
});

describe("alertRuleValidator", () => {
  it("should accept valid alert rule", () => {
    const result = alertRuleValidator.safeParse({
      organizationId: "org-123",
      ruleName: "Temperatura alta",
      severity: "p0",
      conditionOperator: "gt",
      thresholdValue: 30.0,
      channels: ["whatsapp", "push"],
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid severity", () => {
    const result = alertRuleValidator.safeParse({
      organizationId: "org-123",
      ruleName: "Temperatura alta",
      severity: "critical",
      conditionOperator: "gt",
      thresholdValue: 30.0,
      channels: ["whatsapp"],
    });
    expect(result.success).toBe(false);
  });

  it("should require thresholdValueMax when operator is between", () => {
    const result = alertRuleValidator.safeParse({
      organizationId: "org-123",
      ruleName: "Temperatura en rango",
      severity: "p2",
      conditionOperator: "between",
      thresholdValue: 2.0,
      channels: ["push"],
    });
    expect(result.success).toBe(false);
  });
});

describe("billingEventValidator", () => {
  it("should accept valid billing event", () => {
    const result = billingEventValidator.safeParse({
      organizationId: "org-123",
      deviceSubscriptionId: "sub-001",
      eventType: "api_call_tuya",
      deviceExternalId: "tuya-device-001",
    });
    expect(result.success).toBe(true);
  });
});

describe("complianceTemplateValidator", () => {
  it("should accept valid compliance template", () => {
    const result = complianceTemplateValidator.safeParse({
      organizationId: "org-123",
      name: "HACCP Colombia - Camaras frias",
      regulation: "HACCP",
      countryCode: "CO",
      thresholds: { coldRoom: { minTempCelsius: 2, maxTempCelsius: 4 } },
      reportSchedule: "daily",
    });
    expect(result.success).toBe(true);
  });
});

describe("deviceCreateValidator", () => {
  it("should accept valid device creation payload", () => {
    const result = deviceCreateValidator.safeParse({
      organizationId: "org-001",
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      location: "Planta Baja",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing organizationId", () => {
    const result = deviceCreateValidator.safeParse({
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
    });
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict mode)", () => {
    const result = deviceCreateValidator.safeParse({
      organizationId: "org-001",
      name: "Camara Fria #3",
      deviceExternalId: "tuya-device-001",
      protocolType: "tuya",
      randomUnknownField: "should-be-rejected",
    });
    expect(result.success).toBe(false);
  });
});

describe("deviceUpdateValidator", () => {
  it("should accept partial update with just name", () => {
    const result = deviceUpdateValidator.safeParse({
      name: "Nuevo nombre",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty object (all fields optional)", () => {
    const result = deviceUpdateValidator.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should reject unknown fields (strict mode)", () => {
    const result = deviceUpdateValidator.safeParse({
      name: "Nuevo nombre",
      unknownField: "intruso",
    });
    expect(result.success).toBe(false);
  });

  it("should accept full update with all fields", () => {
    const result = deviceUpdateValidator.safeParse({
      name: "Camara Fria #5",
      deviceExternalId: "tuya-device-002",
      protocolType: "modbus",
      location: "Sotano",
      latitude: 4.711,
      longitude: -74.072,
    });
    expect(result.success).toBe(true);
  });
});