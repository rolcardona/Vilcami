/**
 * Rule Engine Service — orchestrator that evaluates alert rules.
 * Routes each rule to the correct evaluator and filters out
 * non-triggered results and maintenance-window-muted rules.
 */

import type {
  AlertRule,
  RuleEvaluationResult,
  TelemetryReading,
  HourlyAggregation,
} from "./rule-engine.types";

import {
  evaluateCriticalThreshold,
  evaluateY2Differential,
  evaluateConsecutiveStreak,
  evaluateStandardDeviation,
  isWithinMaintenanceWindow,
  filterReadingsByTimeDelay,
} from "./rule-engine.helpers";

// ---------------------------------------------------------------------------
// evaluateRules — main orchestrator
// ---------------------------------------------------------------------------

export async function evaluateRules(
  rules: AlertRule[],
  readings: TelemetryReading[],
  hourlyAggregations: HourlyAggregation[],
  nowMs: number,
): Promise<RuleEvaluationResult[]> {
  if (rules.length === 0) return [];

  const triggeredResults: RuleEvaluationResult[] = [];

  for (const rule of rules) {
    // 1. Skip rules within maintenance window
    if (isWithinMaintenanceWindow(rule, nowMs)) continue;

    // 2. Apply time delay filter to readings
    const filteredReadings = applyTimeDelayFilter(readings, rule, nowMs);

    // 3. Route to the correct evaluator based on ruleType
    const result = routeToEvaluator(rule, filteredReadings, hourlyAggregations);
    if (result === undefined) continue; // unknown ruleType or no readings

    // 4. Collect only triggered results
    if (result.triggered) triggeredResults.push(result);
  }

  return triggeredResults;
}

// ---------------------------------------------------------------------------
// routeToEvaluator — dispatches rule to its evaluator
// ---------------------------------------------------------------------------

function routeToEvaluator(
  rule: AlertRule,
  readings: TelemetryReading[],
  aggregations: HourlyAggregation[],
): RuleEvaluationResult | undefined {
  switch (rule.ruleType) {
    case "critical_threshold": {
      if (readings.length === 0) return undefined;
      const latestSensorValue = readings[readings.length - 1].value;
      return evaluateCriticalThreshold(rule, latestSensorValue);
    }
    case "y2_differential":
      return evaluateY2Differential(rule, readings);
    case "consecutive_streak":
      return evaluateConsecutiveStreak(rule, readings);
    case "standard_deviation":
      return evaluateStandardDeviation(rule, aggregations);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// applyTimeDelayFilter — filters readings when timeDelayMs is set
// ---------------------------------------------------------------------------

function applyTimeDelayFilter(
  readings: TelemetryReading[],
  rule: AlertRule,
  evaluationTimestampMs: number,
): TelemetryReading[] {
  if (rule.timeDelayMs !== undefined && rule.timeDelayMs > 0) {
    return filterReadingsByTimeDelay(readings, rule.timeDelayMs, evaluationTimestampMs);
  }
  return readings;
}