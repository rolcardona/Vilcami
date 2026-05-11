/**
 * Types and internal helpers for aggregation-cron.service.ts.
 *
 * These are pure data structures and pure utility functions.
 * No D1, no KV, no side effects.
 */

// ---------------------------------------------------------------------------
// Exported types (re-exported by aggregation-cron.service.ts)
// ---------------------------------------------------------------------------

/** Telemetry entry shape — what we read from KV before aggregation. */
export interface TelemetryEntry {
  organizationId: string;
  deviceId: string;
  sensorId: string;
  value: number;
  unit: string;
  timestamp: number; // Unix epoch milliseconds
}

/**
 * Output row for hourly aggregation.
 * Corresponds to the `hourly_averages` Drizzle table shape (without createdAt).
 */
export interface HourlyAggregationRow {
  id: string;
  organizationId: string;
  deviceId: string;
  sensorId: string;
  hourBucket: Date; // Start of the hour (e.g., 2025-01-15T08:00:00.000Z)
  avgValue: number;
  minValue: number;
  maxValue: number;
  sampleCount: number;
}

/**
 * Output row for daily summary.
 * Corresponds to the `daily_summaries` Drizzle table shape (without createdAt).
 */
export interface DailySummaryRow {
  id: string;
  organizationId: string;
  deviceId: string;
  sensorId: string;
  dateBucket: string; // "YYYY-MM-DD"
  avgValue: number;
  minValue: number;
  maxValue: number;
  stdDev: number | null;
  sampleCount: number;
  alertCount: number;
}

// ---------------------------------------------------------------------------
// Internal accumulator types
// ---------------------------------------------------------------------------

export interface HourlyGroupAccumulator {
  organizationId: string;
  deviceId: string;
  sensorId: string;
  hourBucket: Date;
  values: number[];
}

export interface DailyGroupAccumulator {
  organizationId: string;
  deviceId: string;
  sensorId: string;
  rows: HourlyAggregationRow[];
}

// ---------------------------------------------------------------------------
// Internal pure helpers
// ---------------------------------------------------------------------------

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * Rounds a Unix-epoch-ms timestamp down to the start of its hour bucket.
 */
export function roundDownToHour(timestampMs: number): number {
  return Math.floor(timestampMs / MILLISECONDS_PER_HOUR) * MILLISECONDS_PER_HOUR;
}

/**
 * Formats a Date object as "YYYY-MM-DD" using UTC fields.
 */
export function formatDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
