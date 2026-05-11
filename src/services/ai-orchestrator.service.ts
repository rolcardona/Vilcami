/**
 * AI Orchestrator Service — coordinates the full intelligent monitoring cycle.
 * Per org: read rules → read telemetry → evaluate → AI context → persist → notify.
 * Organizations processed SEQUENTIALLY; each org failure isolated via try/catch.
 */
import { evaluateRules } from "./rule-engine.service";
import { generateAlertContext } from "./alert-generator.service";
import { dispatchNotifications } from "./notification-dispatcher.service";
import type { AlertRule, RuleEvaluationResult, TelemetryReading, HourlyAggregation } from "./rule-engine.types";
import type { NotificationPayload, NotificationRecipient, NotificationSeverity } from "../adapters/notification-adapter.interface";
import type { NotificationRegistryConfigs } from "../adapters/notification-registry";
import type { Env } from "../types/env";
import type { AiContextOutput } from "../validators/ai-context.validator";
import { getDrizzleDb } from "../utils/db.util";
import { organizations } from "../schema/organizations";
import { alertRules } from "../schema/alert-rules";
import { hourlyAverages } from "../schema/hourly-averages";
import { alerts } from "../schema/alerts";
import { alertLifecycle } from "../schema/alert-lifecycle";
import { alertAuditLog } from "../schema/alert-audit-log";
import { memberProfiles } from "../schema/member-profiles";
import { pushSubscriptions } from "../schema/push-subscriptions";
import { eq, and, desc, gte } from "drizzle-orm";

const RULE_TO_ALERT_SEVERITY: Record<string, NotificationSeverity> = {
  p0: "critical", p1: "high", p2: "medium", p3: "low",
};

type AlertRuleType = "critical_threshold" | "y2_differential" | "consecutive_streak" | "standard_deviation";

export interface MonitoringCycleResult {
  organizationId: string;
  rulesEvaluated: number;
  alertsTriggered: number;
  notificationsSent: number;
  notificationsFailed: number;
  cycleDurationMs: number;
}

interface RawTelemetryEntry { sensorType: string; value: number; timestamp: number }

export async function runIntelligentMonitoringCycle(env: Env): Promise<MonitoringCycleResult[]> {
  const db = getDrizzleDb(env);
  const organizationRows = await db.select({ id: organizations.id }).from(organizations).all();
  if (organizationRows.length === 0) return [];

  const cycleResults: MonitoringCycleResult[] = [];
  for (const orgRow of organizationRows) {
    const cycleStartMs = Date.now();
    try {
      cycleResults.push(await processOrganizationCycle(env, db, orgRow.id));
    } catch (error: unknown) {
      console.error(`[orchestrator] Org ${orgRow.id} cycle failed:`, error);
      cycleResults.push({
        organizationId: orgRow.id, rulesEvaluated: 0, alertsTriggered: 0,
        notificationsSent: 0, notificationsFailed: 0, cycleDurationMs: Date.now() - cycleStartMs,
      });
    }
  }
  return cycleResults;
}

async function processOrganizationCycle(
  env: Env, db: ReturnType<typeof getDrizzleDb>, orgId: string,
): Promise<MonitoringCycleResult> {
  const cycleStartMs = Date.now();
  const enabledRules = await db.select().from(alertRules)
    .where(and(eq(alertRules.organizationId, orgId), eq(alertRules.enabled, true))).all();
  if (enabledRules.length === 0) {
    return { organizationId: orgId, rulesEvaluated: 0, alertsTriggered: 0,
      notificationsSent: 0, notificationsFailed: 0, cycleDurationMs: Date.now() - cycleStartMs };
  }

  const hourlyAggregations = await readHourlyAggregations(db, orgId);
  const telemetryReadings = await readKvTelemetry(env, orgId);
  const triggeredResults = await evaluateRules(
    enabledRules as unknown as AlertRule[], telemetryReadings, hourlyAggregations, Date.now(),
  );

  let totalSent = 0; let totalFailed = 0;
  for (const triggeredRule of triggeredResults) {
    const matchedRule = enabledRules.find((r) => r.id === triggeredRule.ruleId);
    const mappedSeverity = resolveAlertSeverity(triggeredRule, matchedRule?.severity);
    const aiContext = await generateAlertContext(triggeredRule, env);
    const deviceId = (matchedRule?.deviceId as string) ?? "unknown";
    const alertId = await persistAlertRecords(db, orgId, triggeredRule, aiContext, matchedRule, mappedSeverity);
    const recipients = await buildNotificationRecipients(db, orgId);
    const dispatchResult = await dispatchNotifications(
      buildNotificationPayload(alertId, orgId, triggeredRule, aiContext, mappedSeverity, deviceId),
      matchedRule ?? {}, recipients, {} as NotificationRegistryConfigs,
    );
    let sent = 0; let failed = 0;
    dispatchResult.recipientResults.forEach((s: boolean) => { s ? sent++ : failed++; });
    totalSent += sent; totalFailed += failed;
  }

  return { organizationId: orgId, rulesEvaluated: enabledRules.length, alertsTriggered: triggeredResults.length,
    notificationsSent: totalSent, notificationsFailed: totalFailed, cycleDurationMs: Date.now() - cycleStartMs };
}

function resolveAlertSeverity(ruleResult: RuleEvaluationResult, ruleSeverity: string | undefined): NotificationSeverity {
  if (ruleSeverity) return RULE_TO_ALERT_SEVERITY[ruleSeverity] ?? "medium";
  return RULE_TO_ALERT_SEVERITY[ruleResult.ruleType === "critical_threshold" ? "p0" : "p2"] ?? "medium";
}

async function readHourlyAggregations(db: ReturnType<typeof getDrizzleDb>, orgId: string): Promise<HourlyAggregation[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select().from(hourlyAverages)
    .where(and(eq(hourlyAverages.organizationId, orgId), gte(hourlyAverages.hourBucket, twentyFourHoursAgo)))
    .orderBy(desc(hourlyAverages.hourBucket)).all();
  return rows.map((row) => ({
    hour: row.hourBucket instanceof Date ? row.hourBucket.getTime() : Number(row.hourBucket),
    avg: row.avgValue, min: row.minValue, max: row.maxValue,
    count: row.sampleCount, stddev: 0, sensorType: row.sensorId,
  }));
}

async function readKvTelemetry(env: Env, orgId: string): Promise<TelemetryReading[]> {
  const kvListResult = await env.TELEMETRY_RAW.list({ prefix: `telemetry:${orgId}:` });
  const readings: TelemetryReading[] = [];
  for (const kvKey of kvListResult.keys) {
    const rawValue = await env.TELEMETRY_RAW.get(kvKey.name);
    if (rawValue) {
      try {
        const parsed: RawTelemetryEntry = JSON.parse(rawValue);
        readings.push({ sensorType: parsed.sensorType, value: parsed.value, timestamp: parsed.timestamp });
      } catch { /* skip malformed */ }
    }
  }
  return readings;
}

async function persistAlertRecords(
  db: ReturnType<typeof getDrizzleDb>, orgId: string, triggeredRule: RuleEvaluationResult,
  aiContext: AiContextOutput, matchedRule: Record<string, unknown> | undefined, mappedSeverity: NotificationSeverity,
): Promise<string> {
  const alertId = crypto.randomUUID();
  await db.insert(alerts).values({
    id: alertId, organizationId: orgId, deviceId: (matchedRule?.deviceId as string) ?? "unknown",
    sensorType: triggeredRule.sensorType, severity: mappedSeverity,
    ruleType: triggeredRule.ruleType as AlertRuleType,
    currentValue: String(triggeredRule.currentValue), thresholdValue: String(triggeredRule.thresholdValue),
    aiMessage: aiContext.message, aiContext: JSON.stringify(aiContext),
    channels: (matchedRule?.channels as string) ?? "push",
  }).run();
  const lifecycleId = crypto.randomUUID();
  await db.insert(alertLifecycle).values({
    id: lifecycleId, organizationId: orgId, alertId, alertRuleId: triggeredRule.ruleId,
    status: "active", triggeredAt: new Date(),
  }).run();
  await db.insert(alertAuditLog).values({
    id: crypto.randomUUID(), organizationId: orgId, alertLifecycleId: lifecycleId,
    action: "triggered", performedBy: null, timestamp: new Date(), details: triggeredRule.details,
  }).run();
  return alertId;
}

async function buildNotificationRecipients(db: ReturnType<typeof getDrizzleDb>, orgId: string): Promise<NotificationRecipient[]> {
  const profileRows = await db.select().from(memberProfiles)
    .where(eq(memberProfiles.organizationId, orgId)).all();
  const pushRows = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.organizationId, orgId)).all();
  return profileRows.map((profile) => {
    const pushRow = pushRows.find((ps) => ps.memberId === profile.memberId);
    return {
      memberId: profile.memberId, email: profile.email ?? undefined,
      whatsappNumber: profile.whatsappNumber ?? undefined, smsNumber: profile.smsNumber ?? undefined,
      pushSubscription: pushRow
        ? { endpoint: pushRow.endpoint, p256dhKey: pushRow.p256dhKey, authKey: pushRow.authKey }
        : undefined,
    };
  });
}

function buildNotificationPayload(
  alertId: string, orgId: string, triggeredRule: RuleEvaluationResult,
  aiContext: AiContextOutput, mappedSeverity: NotificationSeverity, deviceId: string,
): NotificationPayload {
  return {
    alertId, organizationId: orgId, severity: mappedSeverity, message: aiContext.message,
    sensorType: triggeredRule.sensorType, deviceId,
    currentValue: triggeredRule.currentValue, thresholdValue: triggeredRule.thresholdValue,
  };
}