import { eq, and, desc, inArray, sql, isNull } from "drizzle-orm";
import type { Env } from "../types/env";
import { alerts, alertLifecycle, pushSubscriptions } from "../schema/index";
import { getDrizzleDb } from "../utils/db.util";

/** API severity p0-p3 maps to DB critical/high/medium/low */
const SEVERITY_MAP: Record<string, "critical" | "high" | "medium" | "low"> = {
  p0: "critical", p1: "high", p2: "medium", p3: "low",
};

type AlertRow = typeof alerts.$inferSelect;
type SeverityValue = "critical" | "high" | "medium" | "low";
type LifecycleStatus = "active" | "acknowledged" | "returned_to_normal" | "shelved" | "suppressed" | "out_of_service";

/** Build org-scoped condition for alerts table */
function alertOrgWhere(alertId: string, orgFilter: string | null) {
  const conditions = [eq(alerts.id, alertId)];
  if (orgFilter !== null) conditions.push(eq(alerts.organizationId, orgFilter));
  return and(...conditions);
}

/** Find alert by ID with org scoping, or return null */
async function findAlert(env: Env, alertId: string, orgFilter: string | null): Promise<AlertRow | null> {
  const row = await getDrizzleDb(env).select().from(alerts)
    .where(alertOrgWhere(alertId, orgFilter)).get();
  return row ?? null;
}

/** Re-fetch alert after update (org-scoped for multi-tenant safety) */
async function refetchAlert(env: Env, alertId: string, orgFilter: string | null): Promise<AlertRow> {
  const row = await getDrizzleDb(env).select().from(alerts)
    .where(alertOrgWhere(alertId, orgFilter)).get();
  if (!row) throw new Error(`Alert ${alertId} not found after update`);
  return row;
}

// ---------------------------------------------------------------------------
// GET /api/alerts — List alerts with pagination and filters
// ---------------------------------------------------------------------------
export async function listAlerts(
  env: Env, organizationFilter: string | null,
  filters: { page: number; limit: number; severity?: string; status?: string; deviceId?: string },
) {
  const db = getDrizzleDb(env);
  const conditions = [];
  if (organizationFilter !== null) conditions.push(eq(alerts.organizationId, organizationFilter));
  if (filters.severity) {
    const mapped: SeverityValue = SEVERITY_MAP[filters.severity] ?? "critical";
    conditions.push(eq(alerts.severity, mapped));
  }
  if (filters.deviceId) conditions.push(eq(alerts.deviceId, filters.deviceId));

  if (filters.status) {
    const statusVal = filters.status as LifecycleStatus;
    const lifecycleRows = await db.select({ alertId: alertLifecycle.alertId })
      .from(alertLifecycle).where(eq(alertLifecycle.status, statusVal));
    const matchedIds = lifecycleRows.map((r) => r.alertId).filter((id): id is string => id !== null);
    if (matchedIds.length === 0) return { alerts: [], total: 0, page: filters.page, limit: filters.limit };
    conditions.push(inArray(alerts.id, matchedIds));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (filters.page - 1) * filters.limit;
  const rows = await db.select().from(alerts)
    .where(whereClause).limit(filters.limit).offset(offset).orderBy(desc(alerts.createdAt));

  return { alerts: rows, total: rows.length, page: filters.page, limit: filters.limit };
}

// ---------------------------------------------------------------------------
// GET /api/alerts/:alertId — Get alert with AI context
// ---------------------------------------------------------------------------
export async function getAlertById(env: Env, alertId: string, organizationFilter: string | null) {
  return { alert: await findAlert(env, alertId, organizationFilter) };
}

// ---------------------------------------------------------------------------
// PATCH /api/alerts/:alertId/acknowledge
// ---------------------------------------------------------------------------
export async function acknowledgeAlert(
  env: Env, alertId: string, organizationFilter: string | null,
  userId: string, _notes?: string,
) {
  const existing = await findAlert(env, alertId, organizationFilter);
  if (!existing) return { success: false, error: "Alert not found" } as const;

  const now = Math.floor(Date.now() / 1000);
  const db = getDrizzleDb(env);
  await db.update(alerts).set({ acknowledgedAt: now, updatedAt: now }).where(eq(alerts.id, alertId)).run();
  await db.update(alertLifecycle).set({
    status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: userId,
  }).where(and(eq(alertLifecycle.alertId, existing.id), eq(alertLifecycle.status, "active"))).run();

  return { success: true, alert: await refetchAlert(env, alertId, organizationFilter) } as const;
}

// ---------------------------------------------------------------------------
// PATCH /api/alerts/:alertId/resolve
// ---------------------------------------------------------------------------
export async function resolveAlert(
  env: Env, alertId: string, organizationFilter: string | null,
  userId: string, _notes?: string,
) {
  const existing = await findAlert(env, alertId, organizationFilter);
  if (!existing) return { success: false, error: "Alert not found" } as const;

  const now = Math.floor(Date.now() / 1000);
  const db = getDrizzleDb(env);
  await db.update(alerts).set({ resolvedAt: now, updatedAt: now }).where(eq(alerts.id, alertId)).run();
  await db.update(alertLifecycle).set({
    status: "returned_to_normal", returnedToNormalAt: new Date(),
  }).where(and(
    eq(alertLifecycle.alertId, existing.id),
    sql`${alertLifecycle.status} IN ('active', 'acknowledged', 'shelved')`,
  )).run();

  return { success: true, alert: await refetchAlert(env, alertId, organizationFilter) } as const;
}

// ---------------------------------------------------------------------------
// POST /api/alerts/:alertId/shelve
// ---------------------------------------------------------------------------
export async function shelveAlert(
  env: Env, alertId: string, organizationFilter: string | null,
  _userId: string, untilTimestamp: number, _reason: string,
) {
  const existing = await findAlert(env, alertId, organizationFilter);
  if (!existing) return { success: false, error: "Alert not found" } as const;

  const db = getDrizzleDb(env);
  await db.update(alertLifecycle).set({
    status: "shelved", shelvedUntil: new Date(untilTimestamp * 1000),
  }).where(and(
    eq(alertLifecycle.alertId, existing.id),
    sql`${alertLifecycle.status} IN ('active', 'acknowledged')`,
  )).run();

  return { success: true, alert: await refetchAlert(env, alertId, organizationFilter) } as const;
}

// ---------------------------------------------------------------------------
// GET /api/alerts/active/count — Count active alerts by severity
// ---------------------------------------------------------------------------
export async function getActiveAlertCountsBySeverity(env: Env, organizationFilter: string | null) {
  const conditions = [isNull(alerts.resolvedAt), isNull(alerts.acknowledgedAt)];
  if (organizationFilter !== null) conditions.push(eq(alerts.organizationId, organizationFilter));

  const rows = await getDrizzleDb(env).select({
    severity: alerts.severity, count: sql<number>`count(*)`.as("count"),
  }).from(alerts).where(and(...conditions)).groupBy(alerts.severity);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.severity] = row.count;
  return { counts };
}

// ---------------------------------------------------------------------------
// POST /api/push-subscriptions — Register browser push subscription
// ---------------------------------------------------------------------------
export async function createPushSubscription(
  env: Env, organizationId: string, memberId: string,
  input: { endpoint: string; p256dhKey: string; authKey: string },
) {
  const inserted = await getDrizzleDb(env).insert(pushSubscriptions).values({
    id: crypto.randomUUID(), organizationId, memberId,
    endpoint: input.endpoint, p256dhKey: input.p256dhKey, authKey: input.authKey,
  }).returning().get();
  return { success: true, subscription: inserted } as const;
}