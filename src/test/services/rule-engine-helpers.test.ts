import { describe, it, expect } from "vitest";
import {
  evaluateCriticalThreshold,
  evaluateY2Differential,
  evaluateConsecutiveStreak,
  evaluateStandardDeviation,
  isWithinMaintenanceWindow,
  filterReadingsByTimeDelay,
} from "../../services/rule-engine.helpers";
import type {
  AlertRule,
  TelemetryReading,
  HourlyAggregation,
} from "../../services/rule-engine.types";

// ---------------------------------------------------------------------------
// Factory helpers — keep test data DRY and ultra-descriptive
// ---------------------------------------------------------------------------

function createCriticalThresholdRule(
  overrides: Partial<AlertRule> = {},
): AlertRule {
  return {
    id: "rule-critical-001",
    organizationId: "org-coldroom",
    sensorType: "temperature",
    ruleType: "critical_threshold",
    conditionOperator: "gt",
    thresholdValue: -18,
    enabled: true,
    ...overrides,
  };
}

function createTelemetryReading(
  value: number,
  timestampMs: number,
  sensorType = "temperature",
): TelemetryReading {
  return { timestamp: timestampMs, value, sensorType };
}

function createHourlyAggregation(
  stddev: number,
  sensorType = "temperature",
): HourlyAggregation {
  return {
    hour: 1700000000000,
    avg: 5.0,
    min: 2.0,
    max: 8.0,
    count: 60,
    stddev,
    sensorType,
  };
}

// ---------------------------------------------------------------------------
// evaluateCriticalThreshold
// ---------------------------------------------------------------------------

describe("evaluateCriticalThreshold", () => {
  it("should trigger when value exceeds threshold with 'gt' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gt",
      thresholdValue: -18,
    });
    const result = evaluateCriticalThreshold(rule, -15);
    expect(result.triggered).toBe(true);
    expect(result.currentValue).toBe(-15);
    expect(result.thresholdValue).toBe(-18);
    expect(result.ruleId).toBe("rule-critical-001");
  });

  it("should NOT trigger when value equals threshold with 'gt' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gt",
      thresholdValue: -18,
    });
    const result = evaluateCriticalThreshold(rule, -18);
    expect(result.triggered).toBe(false);
  });

  it("should NOT trigger when value is below threshold with 'gt' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gt",
      thresholdValue: -18,
    });
    const result = evaluateCriticalThreshold(rule, -20);
    expect(result.triggered).toBe(false);
  });

  it("should trigger when value is below threshold with 'lt' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "lt",
      thresholdValue: 10,
    });
    const result = evaluateCriticalThreshold(rule, 5);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when value equals threshold with 'lt' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "lt",
      thresholdValue: 10,
    });
    const result = evaluateCriticalThreshold(rule, 10);
    expect(result.triggered).toBe(false);
  });

  it("should trigger when value equals threshold with 'gte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gte",
      thresholdValue: 80,
    });
    const result = evaluateCriticalThreshold(rule, 80);
    expect(result.triggered).toBe(true);
  });

  it("should trigger when value exceeds threshold with 'gte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gte",
      thresholdValue: 80,
    });
    const result = evaluateCriticalThreshold(rule, 85);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when value is below threshold with 'gte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gte",
      thresholdValue: 80,
    });
    const result = evaluateCriticalThreshold(rule, 79);
    expect(result.triggered).toBe(false);
  });

  it("should trigger when value equals threshold with 'lte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "lte",
      thresholdValue: -25,
    });
    const result = evaluateCriticalThreshold(rule, -25);
    expect(result.triggered).toBe(true);
  });

  it("should trigger when value is below threshold with 'lte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "lte",
      thresholdValue: -25,
    });
    const result = evaluateCriticalThreshold(rule, -30);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when value exceeds threshold with 'lte' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "lte",
      thresholdValue: -25,
    });
    const result = evaluateCriticalThreshold(rule, -20);
    expect(result.triggered).toBe(false);
  });

  it("should trigger when value equals threshold with 'eq' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "eq",
      thresholdValue: 0,
    });
    const result = evaluateCriticalThreshold(rule, 0);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when value differs from threshold with 'eq' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "eq",
      thresholdValue: 0,
    });
    const result = evaluateCriticalThreshold(rule, 1);
    expect(result.triggered).toBe(false);
  });

  it("should trigger when value is within [thresholdMin, thresholdMax] with 'between' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "between",
      thresholdValue: 0,
      thresholdMin: -5,
      thresholdMax: 5,
    });
    const result = evaluateCriticalThreshold(rule, 3);
    expect(result.triggered).toBe(true);
  });

  it("should trigger when value equals thresholdMin with 'between' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "between",
      thresholdValue: 0,
      thresholdMin: -5,
      thresholdMax: 5,
    });
    const result = evaluateCriticalThreshold(rule, -5);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when value is outside range with 'between' operator", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "between",
      thresholdValue: 0,
      thresholdMin: -5,
      thresholdMax: 5,
    });
    const result = evaluateCriticalThreshold(rule, 10);
    expect(result.triggered).toBe(false);
  });

  it("should return human-readable details explaining the evaluation", () => {
    const rule = createCriticalThresholdRule({
      conditionOperator: "gt",
      thresholdValue: -18,
    });
    const result = evaluateCriticalThreshold(rule, -15);
    expect(result.details).toContain("-15");
    expect(result.details).toContain("-18");
  });
});

// ---------------------------------------------------------------------------
// evaluateY2Differential
// ---------------------------------------------------------------------------

describe("evaluateY2Differential", () => {
  it("should trigger when differential between setpoint and actual is below deadband (default 2)", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20, // setpoint
      deadband: 2,
    });
    // actual = -19, diff = |(-20) - (-19)| = 1 < 2 → trigger
    const readings: TelemetryReading[] = [
      createTelemetryReading(-19, 1700000000000),
    ];
    const result = evaluateY2Differential(rule, readings);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when differential equals or exceeds deadband (2 degrees)", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20, // setpoint
      deadband: 2,
    });
    // actual = -18, diff = |(-20) - (-18)| = 2 → no trigger
    const readings: TelemetryReading[] = [
      createTelemetryReading(-18, 1700000000000),
    ];
    const result = evaluateY2Differential(rule, readings);
    expect(result.triggered).toBe(false);
  });

  it("should NOT trigger when differential exceeds deadband (3 degrees)", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20,
      deadband: 2,
    });
    // actual = -16, diff = 4 > 2 → no trigger
    const readings: TelemetryReading[] = [
      createTelemetryReading(-16, 1700000000000),
    ];
    const result = evaluateY2Differential(rule, readings);
    expect(result.triggered).toBe(false);
  });

  it("should use default deadband of 2 when deadband is not specified", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20,
      // deadband intentionally omitted
    });
    // actual = -19.5, diff = 0.5 < 2 (default) → trigger
    const readings: TelemetryReading[] = [
      createTelemetryReading(-19.5, 1700000000000),
    ];
    const result = evaluateY2Differential(rule, readings);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when there are no readings", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20,
      deadband: 2,
    });
    const result = evaluateY2Differential(rule, []);
    expect(result.triggered).toBe(false);
  });

  it("should use the latest reading for evaluation", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "y2_differential",
      thresholdValue: -20,
      deadband: 2,
    });
    const readings: TelemetryReading[] = [
      createTelemetryReading(-16, 1700000000000), // diff=4, no trigger
      createTelemetryReading(-19, 1700001000000), // diff=1, trigger
    ];
    const result = evaluateY2Differential(rule, readings);
    expect(result.triggered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateConsecutiveStreak
// ---------------------------------------------------------------------------

describe("evaluateConsecutiveStreak", () => {
  it("should trigger when consecutive out-of-range count meets streak threshold", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 3,
    });
    const readings: TelemetryReading[] = [
      createTelemetryReading(-15, 1700000000000), // out of range (-15 > -18)
      createTelemetryReading(-14, 1700001000000), // out of range
      createTelemetryReading(-16, 1700002000000), // out of range → streak=3
    ];
    const result = evaluateConsecutiveStreak(rule, readings);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when streak count is below threshold", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 3,
    });
    const readings: TelemetryReading[] = [
      createTelemetryReading(-15, 1700000000000), // out of range
      createTelemetryReading(-14, 1700001000000), // out of range
      // only 2 consecutive, threshold is 3
    ];
    const result = evaluateConsecutiveStreak(rule, readings);
    expect(result.triggered).toBe(false);
  });

  it("should reset streak when a reading returns within range", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 3,
    });
    const readings: TelemetryReading[] = [
      createTelemetryReading(-15, 1700000000000), // out of range (1)
      createTelemetryReading(-20, 1700001000000), // in range — streak reset
      createTelemetryReading(-14, 1700002000000), // out of range (1)
      createTelemetryReading(-13, 1700003000000), // out of range (2)
      // streak = 2 < 3
    ];
    const result = evaluateConsecutiveStreak(rule, readings);
    expect(result.triggered).toBe(false);
  });

  it("should NOT trigger when there are no readings", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 3,
    });
    const result = evaluateConsecutiveStreak(rule, []);
    expect(result.triggered).toBe(false);
  });

  it("should count only the TAIL consecutive streak for triggering", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 2,
    });
    const readings: TelemetryReading[] = [
      createTelemetryReading(-15, 1700000000000), // out of range (1)
      createTelemetryReading(-20, 1700001000000), // in range — reset
      createTelemetryReading(-14, 1700002000000), // out of range (1)
      createTelemetryReading(-13, 1700003000000), // out of range (2) → trigger
    ];
    const result = evaluateConsecutiveStreak(rule, readings);
    expect(result.triggered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateStandardDeviation
// ---------------------------------------------------------------------------

describe("evaluateStandardDeviation", () => {
  it("should trigger when stddev exceeds threshold", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "standard_deviation",
      stddevThreshold: 1.5,
    });
    const aggregations: HourlyAggregation[] = [
      createHourlyAggregation(2.0), // 2.0 > 1.5 → trigger
    ];
    const result = evaluateStandardDeviation(rule, aggregations);
    expect(result.triggered).toBe(true);
  });

  it("should NOT trigger when stddev equals threshold", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "standard_deviation",
      stddevThreshold: 2.0,
    });
    const aggregations: HourlyAggregation[] = [
      createHourlyAggregation(2.0), // 2.0 == 2.0 → no trigger
    ];
    const result = evaluateStandardDeviation(rule, aggregations);
    expect(result.triggered).toBe(false);
  });

  it("should NOT trigger when stddev is below threshold", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "standard_deviation",
      stddevThreshold: 3.0,
    });
    const aggregations: HourlyAggregation[] = [
      createHourlyAggregation(1.2), // 1.2 < 3.0 → no trigger
    ];
    const result = evaluateStandardDeviation(rule, aggregations);
    expect(result.triggered).toBe(false);
  });

  it("should NOT trigger when there are no aggregations", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "standard_deviation",
      stddevThreshold: 1.5,
    });
    const result = evaluateStandardDeviation(rule, []);
    expect(result.triggered).toBe(false);
  });

  it("should use the LATEST aggregation for evaluation", () => {
    const rule = createCriticalThresholdRule({
      ruleType: "standard_deviation",
      stddevThreshold: 1.5,
    });
    const aggregations: HourlyAggregation[] = [
      createHourlyAggregation(0.5), // first hour, low variance
      createHourlyAggregation(2.5), // latest hour, high variance → trigger
    ];
    const result = evaluateStandardDeviation(rule, aggregations);
    expect(result.triggered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isWithinMaintenanceWindow
// ---------------------------------------------------------------------------

describe("isWithinMaintenanceWindow", () => {
  it("should return true when timestamp falls within maintenance window", () => {
    const rule = createCriticalThresholdRule({
      maintenanceWindowStart: 8, // 08:00
      maintenanceWindowEnd: 10, // 10:00
    });
    // 2023-11-14 09:30 UTC → hour 9, within [8, 10]
    const timestampWithinWindow = new Date(
      Date.UTC(2023, 10, 14, 9, 30, 0),
    ).getTime();
    expect(isWithinMaintenanceWindow(rule, timestampWithinWindow)).toBe(true);
  });

  it("should return false when timestamp is before maintenance window", () => {
    const rule = createCriticalThresholdRule({
      maintenanceWindowStart: 8,
      maintenanceWindowEnd: 10,
    });
    const timestampBeforeWindow = new Date(
      Date.UTC(2023, 10, 14, 7, 0, 0),
    ).getTime();
    expect(isWithinMaintenanceWindow(rule, timestampBeforeWindow)).toBe(false);
  });

  it("should return false when timestamp is after maintenance window", () => {
    const rule = createCriticalThresholdRule({
      maintenanceWindowStart: 8,
      maintenanceWindowEnd: 10,
    });
    const timestampAfterWindow = new Date(
      Date.UTC(2023, 10, 14, 11, 0, 0),
    ).getTime();
    expect(isWithinMaintenanceWindow(rule, timestampAfterWindow)).toBe(false);
  });

  it("should return false when no maintenance window is defined", () => {
    const rule = createCriticalThresholdRule();
    expect(isWithinMaintenanceWindow(rule, Date.now())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterReadingsByTimeDelay
// ---------------------------------------------------------------------------

describe("filterReadingsByTimeDelay", () => {
  it("should filter out readings newer than the delay threshold", () => {
    const now = Date.now();
    const delayMs = 5000; // 5 seconds
    const readings: TelemetryReading[] = [
      createTelemetryReading(10, now - 10000), // 10s ago — include
      createTelemetryReading(20, now - 3000), // 3s ago — exclude
      createTelemetryReading(30, now - 6000), // 6s ago — include
    ];
    const filtered = filterReadingsByTimeDelay(readings, delayMs);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].value).toBe(10);
    expect(filtered[1].value).toBe(30);
  });

  it("should return all readings when delayMs is 0", () => {
    const now = Date.now();
    const readings: TelemetryReading[] = [
      createTelemetryReading(10, now),
      createTelemetryReading(20, now - 1000),
    ];
    const filtered = filterReadingsByTimeDelay(readings, 0);
    expect(filtered).toHaveLength(2);
  });

  it("should return empty array for empty input", () => {
    const filtered = filterReadingsByTimeDelay([], 5000);
    expect(filtered).toEqual([]);
  });

  it("should filter out all readings if none are old enough", () => {
    const now = Date.now();
    const readings: TelemetryReading[] = [
      createTelemetryReading(10, now - 1000),
      createTelemetryReading(20, now - 500),
    ];
    const filtered = filterReadingsByTimeDelay(readings, 5000);
    expect(filtered).toHaveLength(0);
  });
});