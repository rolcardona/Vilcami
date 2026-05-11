import {
  TelemetryEntry,
  HourlyAggregationRow,
  DailySummaryRow,
  HourlyGroupAccumulator,
  DailyGroupAccumulator,
  roundDownToHour,
  formatDateString,
} from "./aggregation-cron.helpers";

// Re-export types so consumers only import from this file
export type {
  TelemetryEntry,
  HourlyAggregationRow,
  DailySummaryRow,
} from "./aggregation-cron.helpers";

// ---------------------------------------------------------------------------
// Public pure functions
// ---------------------------------------------------------------------------

/**
 * Groups telemetry entries by (organizationId, deviceId, sensorId, hourBucket)
 * and computes avg, min, max, and sample count for each group.
 *
 * hourBucket is the timestamp rounded down to the nearest hour boundary.
 *
 * Pure function — no D1, no KV, no side effects.
 */
export function computeHourlyAggregations(
  entries: TelemetryEntry[],
): HourlyAggregationRow[] {
  const groups = new Map<string, HourlyGroupAccumulator>();

  for (const entry of entries) {
    const hourTimestamp = roundDownToHour(entry.timestamp);
    const groupKey =
      `${entry.organizationId}:${entry.deviceId}:${entry.sensorId}:${hourTimestamp}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        organizationId: entry.organizationId,
        deviceId: entry.deviceId,
        sensorId: entry.sensorId,
        hourBucket: new Date(hourTimestamp),
        values: [],
      });
    }

    groups.get(groupKey)!.values.push(entry.value);
  }

  const results: HourlyAggregationRow[] = [];

  for (const [, group] of groups) {
    const valueSum = group.values.reduce(
      (accumulator, current) => accumulator + current,
      0,
    );
    results.push({
      id: crypto.randomUUID(),
      organizationId: group.organizationId,
      deviceId: group.deviceId,
      sensorId: group.sensorId,
      hourBucket: group.hourBucket,
      avgValue: valueSum / group.values.length,
      minValue: Math.min(...group.values),
      maxValue: Math.max(...group.values),
      sampleCount: group.values.length,
    });
  }

  return results;
}

/**
 * Computes daily summaries from hourly aggregation rows.
 *
 * Groups by (organizationId, deviceId, sensorId, dateBucket) and computes:
 *  - avgValue: weighted average of hourly averages (weight = sampleCount)
 *  - minValue: minimum of hourly min values
 *  - maxValue: maximum of hourly max values
 *  - sampleCount: sum of all hourly sample counts
 *  - stdDev: weighted standard deviation using hourly averages.
 *    Set to null when only 1 hourly row exists (cannot compute variance).
 *  - alertCount: from the optional alertCountByDate map, defaults to 0.
 *
 * Pure function — no D1, no KV, no side effects.
 */
export function computeDailySummaries(
  hourlyRows: HourlyAggregationRow[],
  alertCountByDate?: Map<string, number>,
): DailySummaryRow[] {
  const groups = new Map<string, DailyGroupAccumulator>();

  for (const row of hourlyRows) {
    const dateString = formatDateString(row.hourBucket);
    const groupKey =
      `${row.organizationId}:${row.deviceId}:${row.sensorId}:${dateString}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        organizationId: row.organizationId,
        deviceId: row.deviceId,
        sensorId: row.sensorId,
        rows: [],
      });
    }

    groups.get(groupKey)!.rows.push(row);
  }

  const results: DailySummaryRow[] = [];

  for (const [, group] of groups) {
    const dateString = formatDateString(group.rows[0].hourBucket);
    const totalSamples = group.rows.reduce(
      (sum, row) => sum + row.sampleCount,
      0,
    );

    // Weighted average of hourly averages
    const weightedAverage =
      group.rows.reduce(
        (sum, row) => sum + row.avgValue * row.sampleCount,
        0,
      ) / totalSamples;

    // Min of hourly mins, max of hourly maxes
    const dailyMinimum = Math.min(
      ...group.rows.map((row) => row.minValue),
    );
    const dailyMaximum = Math.max(
      ...group.rows.map((row) => row.maxValue),
    );

    // Weighted standard deviation (only meaningful with 2+ hourly rows)
    let dailyStdDev: number | null = null;

    if (group.rows.length > 1) {
      const weightedVariance =
        group.rows.reduce(
          (sum, row) =>
            sum +
            row.sampleCount *
              Math.pow(row.avgValue - weightedAverage, 2),
          0,
        ) / totalSamples;

      dailyStdDev = Math.sqrt(weightedVariance);
    }

    const alertCount = alertCountByDate?.get(dateString) ?? 0;

    results.push({
      id: crypto.randomUUID(),
      organizationId: group.organizationId,
      deviceId: group.deviceId,
      sensorId: group.sensorId,
      dateBucket: dateString,
      avgValue: weightedAverage,
      minValue: dailyMinimum,
      maxValue: dailyMaximum,
      stdDev: dailyStdDev,
      sampleCount: totalSamples,
      alertCount,
    });
  }

  return results;
}
