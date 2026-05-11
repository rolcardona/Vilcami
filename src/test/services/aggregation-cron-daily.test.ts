import { describe, it, expect } from "vitest";
import {
  computeDailySummaries,
  HourlyAggregationRow,
} from "../../services/aggregation-cron.service";

describe("computeDailySummaries", () => {
  it("should compute daily avg, min, max, stddev, and total sample count from hourly aggregations", () => {
    const hourlyRows: HourlyAggregationRow[] = [
      {
        id: "h1",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T08:00:00Z"),
        avgValue: 20.0,
        minValue: 18.0,
        maxValue: 22.0,
        sampleCount: 6,
      },
      {
        id: "h2",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T09:00:00Z"),
        avgValue: 24.0,
        minValue: 22.0,
        maxValue: 26.0,
        sampleCount: 4,
      },
      {
        id: "h3",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T10:00:00Z"),
        avgValue: 28.0,
        minValue: 26.0,
        maxValue: 30.0,
        sampleCount: 2,
      },
    ];

    const results = computeDailySummaries(hourlyRows);

    expect(results.length).toBe(1);

    const summary = results[0];
    expect(summary.dateBucket).toBe("2025-01-15");
    expect(summary.organizationId).toBe("org-1");
    expect(summary.deviceId).toBe("dev-1");
    expect(summary.sensorId).toBe("sensor-1");

    // Weighted average: (20*6 + 24*4 + 28*2) / (6+4+2) = 272/12 ≈ 22.667
    const expectedWeightedAverage = (20 * 6 + 24 * 4 + 28 * 2) / (6 + 4 + 2);
    expect(summary.avgValue).toBeCloseTo(expectedWeightedAverage, 3);

    expect(summary.minValue).toBe(18.0); // Min of hourly mins
    expect(summary.maxValue).toBe(30.0); // Max of hourly maxes
    expect(summary.sampleCount).toBe(12); // Total samples
    expect(summary.alertCount).toBe(0); // Default when no alert map provided

    // Stddev should be a positive number since we have 3 hours
    expect(summary.stdDev).not.toBeNull();
    expect(summary.stdDev!).toBeGreaterThan(0);
  });

  it("should return an empty array for empty input", () => {
    const results = computeDailySummaries([]);
    expect(results).toEqual([]);
  });

  it("should set stdDev to null when only one hourly aggregation exists for a date", () => {
    const hourlyRows: HourlyAggregationRow[] = [
      {
        id: "h1",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T08:00:00Z"),
        avgValue: 20.0,
        minValue: 18.0,
        maxValue: 22.0,
        sampleCount: 100,
      },
    ];

    const results = computeDailySummaries(hourlyRows);

    expect(results.length).toBe(1);
    expect(results[0].stdDev).toBeNull();
    expect(results[0].avgValue).toBe(20.0);
    expect(results[0].sampleCount).toBe(100);
  });

  it("should use the alertCountByDate map to populate alert counts", () => {
    const hourlyRows: HourlyAggregationRow[] = [
      {
        id: "h1",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T08:00:00Z"),
        avgValue: 20.0,
        minValue: 18.0,
        maxValue: 22.0,
        sampleCount: 6,
      },
      {
        id: "h2",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T09:00:00Z"),
        avgValue: 24.0,
        minValue: 22.0,
        maxValue: 26.0,
        sampleCount: 4,
      },
      {
        id: "h3",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-2",
        hourBucket: new Date("2025-01-16T08:00:00Z"),
        avgValue: 30.0,
        minValue: 28.0,
        maxValue: 32.0,
        sampleCount: 3,
      },
    ];

    const alertCountByDate = new Map<string, number>([
      ["2025-01-15", 7],
      ["2025-01-16", 2],
    ]);

    const results = computeDailySummaries(hourlyRows, alertCountByDate);

    expect(results.length).toBe(2);

    const day1 = results.find((r) => r.dateBucket === "2025-01-15")!;
    const day2 = results.find((r) => r.dateBucket === "2025-01-16")!;

    expect(day1.alertCount).toBe(7);
    expect(day2.alertCount).toBe(2);
  });

  it("should default alertCount to 0 when alertCountByDate is not provided", () => {
    const hourlyRows: HourlyAggregationRow[] = [
      {
        id: "h1",
        organizationId: "org-1",
        deviceId: "dev-1",
        sensorId: "sensor-1",
        hourBucket: new Date("2025-01-15T08:00:00Z"),
        avgValue: 20.0,
        minValue: 18.0,
        maxValue: 22.0,
        sampleCount: 6,
      },
    ];

    const results = computeDailySummaries(hourlyRows);

    expect(results.length).toBe(1);
    expect(results[0].alertCount).toBe(0);
  });
});
