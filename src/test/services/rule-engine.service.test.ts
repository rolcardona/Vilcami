import { describe, it, expect, beforeEach } from "vitest";
import { evaluateRules } from "../../services/rule-engine.service";
import type {
  AlertRule,
  TelemetryReading,
  HourlyAggregation,
} from "../../services/rule-engine.types";

// ---------------------------------------------------------------------------
// Factory helpers — keep test data DRY and ultra-descriptive
// ---------------------------------------------------------------------------

function createAlertRule(
  overrides: Partial<AlertRule> = {},
): AlertRule {
  return {
    id: "rule-test-001",
    organizationId: "org-coldroom",
    sensorType: "temperature",
    ruleType: "critical_threshold",
    conditionOperator: "gt",
    thresholdValue: -18,
    enabled: true,
    ...overrides,
  };
}

function createReading(
  value: number,
  timestampMs: number,
  sensorType = "temperature",
): TelemetryReading {
  return { timestamp: timestampMs, value, sensorType };
}

function createAggregation(
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

// Fixed "now" to make tests deterministic (2023-11-15 14:00 UTC)
const FIXED_NOW_MS = new Date(
  Date.UTC(2023, 10, 15, 14, 0, 0),
).getTime();

// ---------------------------------------------------------------------------
// evaluateRules
// ---------------------------------------------------------------------------

describe("evaluateRules", () => {
  let readings: TelemetryReading[];
  let aggregations: HourlyAggregation[];

  beforeEach(() => {
    readings = [
      createReading(-15, FIXED_NOW_MS - 60000),
    ];
    aggregations = [
      createAggregation(2.5),
    ];
  });

  it("should iterate over rules and route each to the correct evaluator", async () => {
    // All 4 rules set up to TRIGGER with the provided data
    const rules: AlertRule[] = [
      // -15 > -18 → triggers
      createAlertRule({ id: "rule-001", ruleType: "critical_threshold" }),
      // thresholdValue=-17, deadband=2, latest=-15, diff=|(-17)-(-15)|=2 → NOT < 2
      // Let's use setpoint -20, deadband 2: diff=|(-20)-(-15)|=5 ≥ 2 → no trigger
      // Better: setpoint -16, deadband 2: diff=|(-16)-(-15)|=1 < 2 → trigger
      createAlertRule({
        id: "rule-002",
        ruleType: "y2_differential",
        thresholdValue: -16,
        deadband: 2,
      }),
      // -15 > -18 for 1 reading, streakThreshold=1 → trigger
      createAlertRule({
        id: "rule-003",
        ruleType: "consecutive_streak",
        streakThreshold: 1,
      }),
      // stddev 2.5 > 1.0 → trigger
      createAlertRule({
        id: "rule-004",
        ruleType: "standard_deviation",
        stddevThreshold: 1.0,
      }),
    ];

    const results = await evaluateRules(rules, readings, aggregations, FIXED_NOW_MS);

    // All 4 rules should trigger and appear in results
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.ruleId)).toEqual([
      "rule-001",
      "rule-002",
      "rule-003",
      "rule-004",
    ]);
  });

  it("should return ONLY triggered results (non-triggered filtered out)", async () => {
    // Rule 1: gt -20, value -15 → -15 > -20 → triggers
    const triggeredRule = createAlertRule({
      id: "rule-triggered",
      conditionOperator: "gt",
      thresholdValue: -20,
    });
    // Rule 2: lt -30, value -15 → -15 < -30 is false → NOT triggered
    const notTriggeredRule = createAlertRule({
      id: "rule-not-triggered",
      conditionOperator: "lt",
      thresholdValue: -30,
    });

    const rules = [triggeredRule, notTriggeredRule];
    const results = await evaluateRules(rules, readings, aggregations, FIXED_NOW_MS);

    // Only the triggered rule should appear
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-triggered");
    expect(results[0].triggered).toBe(true);
  });

  it("should skip rules within maintenance window", async () => {
    const ruleInMaintenance = createAlertRule({
      id: "rule-maintenance",
      conditionOperator: "gt",
      thresholdValue: -20,
      // Maintenance 12:00-16:00 UTC, now is 14:00 UTC → inside window
      maintenanceWindowStart: 12,
      maintenanceWindowEnd: 16,
    });
    const ruleOutsideMaintenance = createAlertRule({
      id: "rule-active",
      conditionOperator: "gt",
      thresholdValue: -20,
      // Maintenance 18:00-22:00 UTC, now is 14:00 UTC → outside window
      maintenanceWindowStart: 18,
      maintenanceWindowEnd: 22,
    });

    const rules = [ruleInMaintenance, ruleOutsideMaintenance];
    const results = await evaluateRules(rules, readings, aggregations, FIXED_NOW_MS);

    // Only the rule outside maintenance window should be evaluated and triggered
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-active");
    expect(results[0].triggered).toBe(true);
  });

  it("should apply time delay filter before evaluation", async () => {
    const now = Date.now();
    const ruleWithDelay = createAlertRule({
      id: "rule-delayed",
      conditionOperator: "gt",
      thresholdValue: -20,
      timeDelayMs: 5000,
    });

    // One reading is too recent (within delay), one is old enough
    const recentReading = createReading(-15, now - 2000);
    const oldEnoughReading = createReading(-15, now - 10000);

    // With delay 5000ms, only oldEnoughReading passes filter
    // -15 > -20 → triggers
    const results = await evaluateRules(
      [ruleWithDelay],
      [recentReading, oldEnoughReading],
      aggregations,
      now,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-delayed");
    expect(results[0].triggered).toBe(true);
  });

  it("should handle empty rules list", async () => {
    const results = await evaluateRules([], readings, aggregations, FIXED_NOW_MS);
    expect(results).toEqual([]);
  });

  it("should handle rules with no matching evaluator (unknown ruleType)", async () => {
    // Cast to bypass TypeScript — simulates an unknown ruleType at runtime
    const malformedRule = {
      ...createAlertRule({ id: "rule-unknown" }),
      ruleType: "unknown_rule_type",
    } as AlertRule;

    const results = await evaluateRules(
      [malformedRule],
      readings,
      aggregations,
      FIXED_NOW_MS,
    );

    // Unknown evaluator should be skipped entirely (no result produced)
    expect(results).toHaveLength(0);
  });

  it("should handle standard_deviation rule correctly", async () => {
    const stddevRule = createAlertRule({
      id: "rule-stddev",
      ruleType: "standard_deviation",
      stddevThreshold: 1.0,
    });
    const highStddevAggregations = [createAggregation(2.5)];

    const results = await evaluateRules(
      [stddevRule],
      readings,
      highStddevAggregations,
      FIXED_NOW_MS,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-stddev");
    expect(results[0].triggered).toBe(true);
  });

  it("should handle y2_differential rule correctly", async () => {
    const y2Rule = createAlertRule({
      id: "rule-y2",
      ruleType: "y2_differential",
      thresholdValue: -16,
      deadband: 2,
    });
    // value -15, diff = |(-16)-(-15)| = 1 < 2 → triggers
    const y2Readings = [createReading(-15, FIXED_NOW_MS - 60000)];

    const results = await evaluateRules(
      [y2Rule],
      y2Readings,
      aggregations,
      FIXED_NOW_MS,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-y2");
    expect(results[0].triggered).toBe(true);
  });

  it("should handle consecutive_streak rule correctly", async () => {
    const streakRule = createAlertRule({
      id: "rule-streak",
      ruleType: "consecutive_streak",
      conditionOperator: "gt",
      thresholdValue: -18,
      streakThreshold: 2,
    });
    const streakReadings = [
      createReading(-15, FIXED_NOW_MS - 120000),
      createReading(-14, FIXED_NOW_MS - 60000),
    ];

    const results = await evaluateRules(
      [streakRule],
      streakReadings,
      aggregations,
      FIXED_NOW_MS,
    );

    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("rule-streak");
    expect(results[0].triggered).toBe(true);
  });
});