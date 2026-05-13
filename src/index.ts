import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types/env";
import { deviceRoutes } from "./routes/devices.routes";
import { telemetryRoutes } from "./routes/telemetry.routes";
import { alertRoutes, pushSubscriptionRoutes } from "./routes/alerts.routes";
import { billingRoutes } from "./routes/billing.routes";
import { webhookRoutes } from "./routes/webhook.routes";
import { memberRoutes } from "./routes/members.routes";
import {
  computeHourlyAggregations,
  computeDailySummaries,
} from "./services/aggregation-cron.service";
import type { TelemetryEntry } from "./services/aggregation-cron.service";
import { runIntelligentMonitoringCycle } from "./services/ai-orchestrator.service";
import { runBillingValidationCycle } from "./services/billing-cron.service";
import { getDrizzleDb } from "./utils/db.util";
import { hourlyAverages } from "./schema/hourly-averages";
import { dailySummaries } from "./schema/daily-summaries";

export const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// CORS — allow frontend (Vercel + localhost dev)
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const allowedOrigins = [
    c.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:4173",
  ].filter(Boolean);

  return cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Total-Count"],
    maxAge: 86400,
    credentials: true,
  })(c, next);
});

// ---------------------------------------------------------------------------
// Health / status
// ---------------------------------------------------------------------------
app.get("/", (c) => {
  return c.json({ status: "ok", service: "vilcami", version: "0.1.0" });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API route groups
// ---------------------------------------------------------------------------
app.route("/api/devices", deviceRoutes);
app.route("/api/telemetry", telemetryRoutes);
app.route("/api/alerts", alertRoutes);
app.route("/api/push-subscriptions", pushSubscriptionRoutes);
app.route("/api/billing", billingRoutes);
app.route("/api/webhooks", webhookRoutes);
app.route("/api/members", memberRoutes);

// ---------------------------------------------------------------------------
// Cron: hourly aggregation (KV raw telemetry → D1 hourly_averages + daily_summaries)
// ---------------------------------------------------------------------------
async function runHourlyAggregation(env: Env): Promise<void> {
  try {
    const kvList = await env.TELEMETRY_RAW.list({ prefix: "telemetry:" });

    if (kvList.keys.length === 0) {
      console.log("[cron] No telemetry entries to aggregate");
      return;
    }

    const telemetryEntries: TelemetryEntry[] = [];

    for (const kvKey of kvList.keys) {
      const rawValue = await env.TELEMETRY_RAW.get(kvKey.name);
      if (rawValue) {
        try {
          const parsed = JSON.parse(rawValue) as TelemetryEntry;
          telemetryEntries.push(parsed);
        } catch {
          // Skip malformed entries silently
        }
      }
    }

    if (telemetryEntries.length === 0) {
      console.log("[cron] No valid telemetry entries found");
      return;
    }

    const hourlyRows = computeHourlyAggregations(telemetryEntries);
    const db = getDrizzleDb(env);

    for (const row of hourlyRows) {
      await db.insert(hourlyAverages).values({
        id: row.id,
        organizationId: row.organizationId,
        deviceId: row.deviceId,
        sensorId: row.sensorId,
        hourBucket: row.hourBucket,
        avgValue: row.avgValue,
        minValue: row.minValue,
        maxValue: row.maxValue,
        sampleCount: row.sampleCount,
      }).run();
    }

    const now = new Date();
    if (now.getHours() === 0 || hourlyRows.length > 0) {
      const dailyRows = computeDailySummaries(hourlyRows);

      for (const row of dailyRows) {
        await db.insert(dailySummaries).values({
          id: row.id,
          organizationId: row.organizationId,
          deviceId: row.deviceId,
          sensorId: row.sensorId,
          dateBucket: row.dateBucket,
          avgValue: row.avgValue,
          minValue: row.minValue,
          maxValue: row.maxValue,
          stdDev: row.stdDev,
          sampleCount: row.sampleCount,
          alertCount: row.alertCount,
        }).run();
      }
    }

    console.log(
      `[cron] Aggregated ${telemetryEntries.length} telemetry entries → ${hourlyRows.length} hourly rows, daily summaries computed`,
    );
  } catch (error) {
    console.error("[cron] Aggregation failed:", error);
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runHourlyAggregation(env));
    ctx.waitUntil(runIntelligentMonitoringCycle(env));
    ctx.waitUntil(runBillingValidationCycle(env));
  },
};
