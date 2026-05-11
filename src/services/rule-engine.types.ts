/**
 * Type definitions for the VILCAMI Rule Engine.
 * Shared between helpers, service, and test layers.
 */

export interface AlertRule {
  id: string;
  organizationId: string;
  sensorType: string;
  ruleType:
    | "critical_threshold"
    | "y2_differential"
    | "consecutive_streak"
    | "standard_deviation";
  conditionOperator:
    | "gt" | "lt" | "gte" | "lte" | "eq" | "between"
    | "streak_gte" | "stddev_gt" | "diff_lt";
  thresholdValue: number;
  thresholdMin?: number;
  thresholdMax?: number;
  deadband?: number; // Y2 default 2°C
  streakThreshold?: number;
  stddevThreshold?: number;
  maintenanceWindowStart?: number;
  maintenanceWindowEnd?: number;
  timeDelayMs?: number;
  enabled: boolean;
}

export interface RuleEvaluationResult {
  ruleId: string;
  sensorType: string;
  ruleType: "critical_threshold" | "y2_differential" | "consecutive_streak" | "standard_deviation";
  triggered: boolean;
  currentValue: number;
  thresholdValue: number;
  details: string;
}

export interface TelemetryReading {
  timestamp: number;
  value: number;
  sensorType: string;
}

export interface HourlyAggregation {
  hour: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  stddev: number;
  sensorType: string;
}