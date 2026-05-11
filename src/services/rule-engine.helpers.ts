/**
 * Pure evaluation helpers for the VILCAMI Rule Engine.
 * No D1, no KV, no AI calls — zero side effects.
 */

import type {
  AlertRule,
  RuleEvaluationResult,
  TelemetryReading,
  HourlyAggregation,
} from "./rule-engine.types";

export type { AlertRule, RuleEvaluationResult, TelemetryReading, HourlyAggregation };

const Y2_DEFAULT_DEADBAND_CELSIUS = 2;

// ---------------------------------------------------------------------------
// evaluateCriticalThreshold
// ---------------------------------------------------------------------------

export function evaluateCriticalThreshold(
  rule: AlertRule,
  sensorValue: number,
): RuleEvaluationResult {
  const isTriggered = checkThresholdOperator(
    rule.conditionOperator, sensorValue, rule.thresholdValue,
    rule.thresholdMin, rule.thresholdMax,
  );
  return {
    ruleId: rule.id, sensorType: rule.sensorType, ruleType: rule.ruleType,
    triggered: isTriggered, currentValue: sensorValue,
    thresholdValue: rule.thresholdValue,
    details: isTriggered
      ? `Value ${sensorValue} triggered ${rule.conditionOperator} ${rule.thresholdValue}`
      : `Value ${sensorValue} did NOT trigger ${rule.conditionOperator} ${rule.thresholdValue}`,
  };
}

function checkThresholdOperator(
  operator: string, value: number, threshold: number,
  thresholdMin?: number, thresholdMax?: number,
): boolean {
  switch (operator) {
    case "gt": return value > threshold;
    case "lt": return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    case "between":
      return thresholdMin !== undefined && thresholdMax !== undefined
        && value >= thresholdMin && value <= thresholdMax;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// evaluateY2Differential
// ---------------------------------------------------------------------------

export function evaluateY2Differential(
  rule: AlertRule, readings: TelemetryReading[],
): RuleEvaluationResult {
  if (readings.length === 0) return notTriggered(rule, 0, rule.thresholdValue, "No readings");
  const latestReading = readings[readings.length - 1];
  const deadbandCelsius = rule.deadband ?? Y2_DEFAULT_DEADBAND_CELSIUS;
  const differentialAbsolute = Math.abs(rule.thresholdValue - latestReading.value);
  const isTriggered = differentialAbsolute < deadbandCelsius;
  return {
    ruleId: rule.id, sensorType: rule.sensorType, ruleType: rule.ruleType,
    triggered: isTriggered, currentValue: latestReading.value,
    thresholdValue: rule.thresholdValue,
    details: isTriggered
      ? `Differential ${differentialAbsolute}°C below deadband ${deadbandCelsius}°C`
      : `Differential ${differentialAbsolute}°C meets deadband ${deadbandCelsius}°C`,
  };
}

// ---------------------------------------------------------------------------
// evaluateConsecutiveStreak
// ---------------------------------------------------------------------------

export function evaluateConsecutiveStreak(
  rule: AlertRule, readings: TelemetryReading[],
): RuleEvaluationResult {
  const requiredStreakCount = rule.streakThreshold ?? 1;
  if (readings.length === 0) return notTriggered(rule, 0, rule.thresholdValue, "No readings");
  let consecutiveCount = 0;
  for (const reading of readings) {
    const isOutOfRange = checkThresholdOperator(
      rule.conditionOperator, reading.value, rule.thresholdValue,
      rule.thresholdMin, rule.thresholdMax,
    );
    consecutiveCount = isOutOfRange ? consecutiveCount + 1 : 0;
  }
  const latestValue = readings[readings.length - 1].value;
  const isTriggered = consecutiveCount >= requiredStreakCount;
  return {
    ruleId: rule.id, sensorType: rule.sensorType, ruleType: rule.ruleType,
    triggered: isTriggered, currentValue: latestValue,
    thresholdValue: rule.thresholdValue,
    details: isTriggered
      ? `Streak ${consecutiveCount} meets threshold ${requiredStreakCount}`
      : `Streak ${consecutiveCount} below threshold ${requiredStreakCount}`,
  };
}

// ---------------------------------------------------------------------------
// evaluateStandardDeviation
// ---------------------------------------------------------------------------

export function evaluateStandardDeviation(
  rule: AlertRule, aggregations: HourlyAggregation[],
): RuleEvaluationResult {
  if (aggregations.length === 0)
    return notTriggered(rule, 0, rule.stddevThreshold ?? 0, "No aggregations");
  const latestAggregation = aggregations[aggregations.length - 1];
  const stddevThreshold = rule.stddevThreshold ?? 0;
  const isTriggered = latestAggregation.stddev > stddevThreshold;
  return {
    ruleId: rule.id, sensorType: rule.sensorType, ruleType: rule.ruleType,
    triggered: isTriggered, currentValue: latestAggregation.stddev,
    thresholdValue: stddevThreshold,
    details: isTriggered
      ? `Stddev ${latestAggregation.stddev} exceeds threshold ${stddevThreshold}`
      : `Stddev ${latestAggregation.stddev} within threshold ${stddevThreshold}`,
  };
}

// ---------------------------------------------------------------------------
// isWithinMaintenanceWindow
// ---------------------------------------------------------------------------

export function isWithinMaintenanceWindow(rule: AlertRule, timestampMs: number): boolean {
  if (rule.maintenanceWindowStart === undefined || rule.maintenanceWindowEnd === undefined)
    return false;
  const currentHour = new Date(timestampMs).getUTCHours();
  return currentHour >= rule.maintenanceWindowStart && currentHour < rule.maintenanceWindowEnd;
}

// ---------------------------------------------------------------------------
// filterReadingsByTimeDelay
// ---------------------------------------------------------------------------

export function filterReadingsByTimeDelay(
  readings: TelemetryReading[], delayMilliseconds: number,
): TelemetryReading[] {
  if (readings.length === 0) return [];
  const cutoffTimestamp = Date.now() - delayMilliseconds;
  return readings.filter((reading) => reading.timestamp <= cutoffTimestamp);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function notTriggered(
  rule: AlertRule, currentValue: number, thresholdValue: number, reason: string,
): RuleEvaluationResult {
  return {
    ruleId: rule.id, sensorType: rule.sensorType, ruleType: rule.ruleType,
    triggered: false, currentValue, thresholdValue, details: reason,
  };
}