import { describe, it, expect } from "vitest";
import {
  computeHourlyAggregations,
  TelemetryEntry,
} from "../../services/aggregation-cron.service";

describe("computeHourlyAggregations", () => {
  it("should compute avg, min, max, and sample count for a single sensor in one hour bucket", () => {
    const entries: TelemetryEntry[] = [
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 4.0,
        unit: "Celsius",
        timestamp: 1700000000000,
      },
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 6.0,
        unit: "Celsius",
        timestamp: 1700001800000,
      },
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 5.0,
        unit: "Celsius",
        timestamp: 1700002000000,
      },
    ];

    const results = computeHourlyAggregations(entries);

    expect(results.length).toBe(1);
    expect(results[0].avgValue).toBeCloseTo(5.0);
    expect(results[0].minValue).toBe(4.0);
    expect(results[0].maxValue).toBe(6.0);
    expect(results[0].sampleCount).toBe(3);
    expect(results[0].organizationId).toBe("org-1");
    expect(results[0].deviceId).toBe("dev-1");
    expect(results[0].sensorId).toBe("sensor-1");
  });

  it("should group by organization, device, sensor, and hour bucket independently", () => {
    const entries: TelemetryEntry[] = [
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-temp",
        value: 20.0,
        unit: "Celsius",
        timestamp: 1700000000000,
      },
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-humidity",
        value: 55.0,
        unit: "Percent",
        timestamp: 1700000100000,
      },
    ];

    const results = computeHourlyAggregations(entries);

    // Two different sensors, same device, same hour => 2 separate aggregation rows
    expect(results.length).toBe(2);

    const temperatureRow = results.find((r) => r.sensorId === "sensor-temp")!;
    const humidityRow = results.find((r) => r.sensorId === "sensor-humidity")!;

    expect(temperatureRow.avgValue).toBe(20.0);
    expect(temperatureRow.sampleCount).toBe(1);
    expect(humidityRow.avgValue).toBe(55.0);
    expect(humidityRow.sampleCount).toBe(1);
  });

  it("should separate entries in different hour buckets for the same sensor", () => {
    const hourOneTimestamp = 1700000000000; // Some point in hour 1
    const hourTwoTimestamp = 1700003600000 + 1; // 1 hour + 1 ms later

    const entries: TelemetryEntry[] = [
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 10.0,
        unit: "Celsius",
        timestamp: hourOneTimestamp,
      },
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 20.0,
        unit: "Celsius",
        timestamp: hourTwoTimestamp,
      },
    ];

    const results = computeHourlyAggregations(entries);

    expect(results.length).toBe(2);

    const hourBuckets = results.map((r) => r.hourBucket.getTime());
    expect(hourBuckets[0]).not.toBe(hourBuckets[1]);

    // Verify each row has exactly 1 sample
    expect(results[0].sampleCount).toBe(1);
    expect(results[1].sampleCount).toBe(1);
    expect(results[0].avgValue === results[0].minValue).toBe(true);
    expect(results[0].minValue === results[0].maxValue).toBe(true);
  });

  it("should return an empty array for empty input", () => {
    const results = computeHourlyAggregations([]);
    expect(results).toEqual([]);
  });

  it("should handle a single entry where avg = min = max = the value itself", () => {
    const entries: TelemetryEntry[] = [
      {
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        value: 42.5,
        unit: "Celsius",
        timestamp: 1700000000000,
      },
    ];

    const results = computeHourlyAggregations(entries);

    expect(results.length).toBe(1);
    expect(results[0].avgValue).toBe(42.5);
    expect(results[0].minValue).toBe(42.5);
    expect(results[0].maxValue).toBe(42.5);
    expect(results[0].sampleCount).toBe(1);
  });
});
