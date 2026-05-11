# Phase 4 AI — Intelligent Monitoring Design Specification

**Date:** 2026-05-10
**Phase:** 4 of 6 (DATA -> IOT -> AUTH -> AI -> BILLING -> UI)
**Status:** Approved
**Depends on:** Phase 1 (DATA) — schemas, D1, KV, aggregation cron; Phase 3 (AUTH) — JWT, org-scoping

---

## 1. Overview

Phase 4 adds the intelligence layer to VILCAMI: a cron-driven system that reads aggregated telemetry from D1, evaluates industrial rules with pure TypeScript, generates contextual alert messages via Workers AI, and dispatches notifications across multiple channels (WhatsApp, SMS, Email, Push).

The design principle is separation of concerns: **rules decide IF there is a problem, AI decides HOW to communicate it.** The rule engine is pure TypeScript with zero AI dependency — deterministic, testable, auditable. Workers AI only generates the human-facing message with contextual recommendations.

The architecture follows the established pattern from `aggregation-cron.service.ts`: pure computation functions live in a `.helpers.ts` file, side-effectful I/O lives in the service, and the cron orchestrator in `index.ts` coordinates the flow.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Cron Trigger (every 1 hour)                      │
│                              │                                      │
│                              ▼                                      │
│              ┌───────────────────────────────┐                       │
│              │    AI Orchestrator Service     │                       │
│              │  (ai-orchestrator.service.ts)  │                       │
│              └───────────┬───────────────────┘                       │
│                          │                                           │
│          ┌───────────────┼───────────────┐                          │
│          ▼               ▼               ▼                          │
│   ┌─────────────┐ ┌─────────────┐ ┌──────────────┐                  │
│   │  Read Data  │ │   Evaluate  │ │   Generate   │                  │
│   │  from D1/KV │ │    Rules    │ │  AI Message   │                  │
│   └──────┬──────┘ └──────┬──────┘ └──────┬───────┘                  │
│          │               │               │                          │
│          │    ┌──────────┴──────────┐     │                          │
│          │    │   Rule Engine       │     │                          │
│          │    │  (pure TypeScript)   │     │                          │
│          │    │  P0 P1 P2 P3        │     │                          │
│          │    └─────────────────────┘     │                          │
│          │                               │                          │
│          │    ┌──────────────────────┐    │                          │
│          │    │  Alert Generator     │    │                          │
│          │    │  (Workers AI call)   │◄───┘                          │
│          │    └──────────┬───────────┘                              │
│          │               │                                          │
│          │    ┌──────────┴───────────┐                              │
│          │    │ Notification        │                              │
│          │    │  Dispatcher         │                              │
│          │    └──────────┬─────────┘                              │
│          │               │                                          │
│          │    ┌──────────┼──────────┬──────────┐                   │
│          │    ▼          ▼          ▼          ▼                   │
│          │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                    │
│          │ │Whats │ │ SMS  │ │Email │ │ Push │                    │
│          │ │ App  │ │      │ │      │ │      │                    │
│          │ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘                    │
│          │    │ Twilio   │ Twilio │SendGrid│WebPush                │
│          │    └──────────┴────────┴───────┘                        │
│          │                                                        │
│          ▼                                                         │
│   ┌─────────────┐                                                 │
│   │  Save Alert  │                                                 │
│   │   to D1      │                                                 │
│   └─────────────┘                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Flow Summary

1. Cron Trigger fires every hour (`0 * * * *`)
2. AI Orchestrator reads telemetry data (recent `hourly_averages` + raw KV) and alert rules from D1
3. Rule Engine evaluates each rule against the telemetry data (pure function, no side effects)
4. For each triggered rule, Alert Generator calls Workers AI to produce a contextual message
5. Notification Dispatcher sends the alert through configured channels via adapters
6. Alert record saved to D1 (`alerts` table) + lifecycle entry created in `alert_lifecycle`
7. Audit log entry written to `alert_audit_log`

---

## 3. Components

### 3.1 Rule Engine — `src/services/rule-engine.service.ts`

The rule engine is a pure-function orchestrator that evaluates alert rules against telemetry data. It does NOT call D1, KV, Workers AI, or any external service. All data is passed as arguments.

```typescript
interface RuleEvaluationInput {
  rule: AlertRuleDefinition;
  telemetryReadings: TelemetryReading[];
  hourlyAggregations: HourlyAggregationRow[];
  dailySummaries: DailySummaryRow[];
}

interface RuleEvaluationResult {
  triggered: boolean;
  severity: "p0" | "p1" | "p2" | "p3";
  ruleId: string;
  ruleType: RuleType;
  deviceId: string;
  sensorId: string;
  organizationId: string;
  currentValue: number;
  thresholdValue: number;
  triggeredAt: Date;
  metadata: Record<string, unknown>;
}
```

**Responsibilities:**
- Iterate over active alert rules for an organization
- Route each rule to its corresponding evaluator based on `conditionOperator`
- Collect all triggered rules into a result array
- Respect maintenance windows (skip evaluation if within window)
- Respect `enabled` flag (skip disabled rules)
- Pure function:
```typescript
function evaluateRules(
  rules: AlertRuleDefinition[],
  telemetry: TelemetryReading[],
  hourly: HourlyAggregationRow[],
  daily: DailySummaryRow[],
  evaluationTimestamp: number,
): RuleEvaluationResult[]
```

**Approximate lines:** 120

### 3.2 Rule Engine Helpers — `src/services/rule-engine.helpers.ts`

Pure types and evaluation functions. Every function is deterministic — same input always produces same output. No `Date.now()`, no `Math.random()`, no external calls.

**Exported types:**

```typescript
type RuleType =
  | "critical_threshold"     // P0
  | "y2_differential"       // P1
  | "consecutive_streak"    // P2
  | "std_deviation";        // P3

interface AlertRuleDefinition {
  id: string;
  organizationId: string;
  deviceId: string | null;
  sensorId: string | null;
  ruleName: string;
  severity: "p0" | "p1" | "p2" | "p3";
  conditionOperator: "gt" | "lt" | "gte" | "lte" | "eq" | "between" | "streak_gte" | "stddev_gt" | "diff_lt";
  thresholdValue: number;
  thresholdValueMax: number | null;
  deadbandValue: number;
  timeDelaySeconds: number;
  channels: string; // JSON array
  enabled: boolean;
  maintenanceWindowStart: Date | null;
  maintenanceWindowEnd: Date | null;
}

interface TelemetryReading {
  organizationId: string;
  deviceId: string;
  sensorId: string;
  value: number;
  unit: string;
  timestamp: number;
}
```

**Exported pure functions:**

```typescript
// P0: Value exceeds critical threshold
function evaluateCriticalThreshold(
  readings: TelemetryReading[],
  threshold: number,
  operator: "gt" | "lt" | "gte" | "lte" | "eq" | "between",
  thresholdMax?: number,
): ThresholdEvaluationResult

// P1: Y2 differential — difference between setpoint and actual < deadband
function evaluateY2Differential(
  readings: TelemetryReading[],
  setpoint: number,
  deadband: number,
): Y2DifferentialResult

// P2: N consecutive readings out of range
function evaluateConsecutiveStreak(
  readings: TelemetryReading[],
  minThreshold: number,
  maxThreshold: number,
  streakCount: number,
): ConsecutiveStreakResult

// P3: Standard deviation exceeds threshold (instability detection)
function evaluateStandardDeviation(
  hourlyAggregations: HourlyAggregationRow[],
  stddevThreshold: number,
): StdDeviationResult

// Utility: check if current time is within a maintenance window
function isWithinMaintenanceWindow(
  currentTime: Date,
  windowStart: Date | null,
  windowEnd: Date | null,
): boolean

// Utility: filter readings by time delay (ignore readings within delay window)
function filterReadingsByTimeDelay(
  readings: TelemetryReading[],
  timeDelaySeconds: number,
  evaluationTimestamp: number,
): TelemetryReading[]
```

**Approximate lines:** 190

### 3.3 Alert Generator — `src/services/alert-generator.service.ts`

Calls Workers AI to produce a contextual, human-readable alert message. This is the ONLY component that uses AI. It does NOT decide if an alert should fire — that is the rule engine's job.

```typescript
interface AlertGenerationInput {
  ruleEvaluationResult: RuleEvaluationResult;
  deviceName: string;
  sensorType: string;
  organizationName: string;
  recentAverage: number;
  unit: string;
  deviation: number; // Computed by the orchestrator as Math.abs(currentValue - thresholdValue)
}

interface AlertGenerationOutput {
  message: string;
  aiContext: string; // JSON string with structured recommendation
}
```

**Workers AI call:**

```typescript
async function generateAlertMessage(
  env: Env,
  input: AlertGenerationInput,
): Promise<AlertGenerationOutput>
```

The function builds a structured prompt (see Section 6), sends it to Workers AI via `env.AI.run()`, and parses the response into `message` (human-readable) and `aiContext` (structured JSON with recommendation, probable cause, suggested action).

**Error handling:** If Workers AI fails or times out, the system falls back to a template-based message generated from the rule evaluation result. Alerts must never be lost due to AI unavailability.

**Approximate lines:** 100

### 3.4 Notification Dispatcher — `src/services/notification-dispatcher.service.ts`

Coordinates sending notifications through multiple channels. Uses the Adapter pattern — it does not know the implementation details of any channel. It receives a list of channel names from the alert rule's `channels` JSON, resolves the corresponding adapter, and calls `send()` on each.

```typescript
interface NotificationDispatchInput {
  alertId: string;
  organizationId: string;
  severity: "p0" | "p1" | "p2" | "p3";
  message: string;
  aiContext: string;
  channels: NotificationChannel[];
  recipientContacts: RecipientContact[];
}

interface NotificationDispatchResult {
  alertId: string;
  dispatchedChannels: DispatchedChannel[];
  failedChannels: FailedChannel[];
}

interface DispatchedChannel {
  channel: string; // "whatsapp" | "sms" | "email" | "push"
  messageId: string | null;
  recipient: string;
}

interface FailedChannel {
  channel: string;
  error: string;
  recipient: string;
}

interface RecipientContact {
  memberName: string;       // from member_profiles.full_name
  whatsappNumber: string | null;  // from member_profiles.whatsapp_number
  smsNumber: string | null;       // from member_profiles.sms_number
  email: string | null;           // from member_profiles.email
  pushSubscriptionEndpoint: string | null;  // from push_subscriptions.endpoint
}
```

**Channel routing by severity:**

| Severity | Default Channels | Escalation Timer |
|---------|-----------------|-----------------|
| P0 | WhatsApp + SMS + Push | 5 min without ack -> escalate to admin |
| P1 | WhatsApp + Push | 15 min without ack -> escalate to admin |
| P2 | Push + Email | 30 min without ack -> auto-shelve |
| P3 | Email only | No escalation |

**Approximate lines:** 130

### 3.5 Notification Adapters — `src/adapters/notification-*.adapter.ts`

One file per channel. All implement the same `NotificationAdapter` interface.

```typescript
interface NotificationAdapter {
  send(alert: AlertMessage, recipient: RecipientContact): Promise<SendResult>;
}

interface AlertMessage {
  alertId: string;
  organizationId: string;
  severity: "p0" | "p1" | "p2" | "p3";
  ruleType: RuleType;
  deviceName: string;
  sensorType: string;
  message: string;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  triggeredAt: Date;
}

interface SendResult {
  success: boolean;
  channel: string;
  messageId: string | null;
  error: string | null;
}
```

**3.5.1 Twilio Adapter — `src/adapters/notification-twilio.adapter.ts`**

Handles both WhatsApp and SMS through Twilio's API. The Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) are stored encrypted in the KV Vault (`SECRETS_VAULT`) and decrypted at runtime using `kv-vault.util.ts`.

- WhatsApp: Uses Twilio WhatsApp Business API (`POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`)
- SMS: Uses Twilio SMS API (same endpoint, `MessagingServiceSid` parameter)
- Both use the same auth credentials
- Phone numbers come from `RecipientContact.whatsappNumber` / `RecipientContact.smsNumber`
- Sender number (`TWILIO_PHONE_NUMBER`) stored in KV Vault per organization

```typescript
class TwilioNotificationAdapter implements NotificationAdapter {
  constructor(private channelType: "whatsapp" | "sms") {}
  async send(alert: AlertMessage, recipient: RecipientContact): Promise<SendResult>;
}
```

**Approximate lines:** 80

**3.5.2 Email Adapter — `src/adapters/notification-email.adapter.ts`**

Sends HTML emails via SendGrid. The `SENDGRID_API_KEY` is stored encrypted in KV Vault.

- Uses SendGrid Mail Send API (`POST https://api.sendgrid.com/v3/mail/send`)
- HTML template: severity-colored header, device/sensor info, AI recommendation, acknowledge link
- From address: `alertas@vilcami.com` (configurable per org in KV)
- Rate limit: max 100 emails per org per hour (prevent spam)

```typescript
class EmailNotificationAdapter implements NotificationAdapter {
  async send(alert: AlertMessage, recipient: RecipientContact): Promise<SendResult>;
}
```

**Approximate lines:** 90

**3.5.3 Push Adapter — `src/adapters/notification-push.adapter.ts`**

Sends browser push notifications via the Web Push API (RFC 8030). Uses VAPID keys for authentication.

- Push subscriptions stored in the `push_subscriptions` table (created in Phase 4, see section 4.4)
- Uses `crypto.subtle` for ECDSA signing (VAPID JWT)
- Payload: JSON with alert summary, click action URL
- TTL: 1 hour for P2/P3, 24 hours for P0/P1
- Handles expired subscriptions (410 Gone) by removing from DB

```typescript
class PushNotificationAdapter implements NotificationAdapter {
  async send(alert: AlertMessage, recipient: RecipientContact): Promise<SendResult>;
}
```

**Approximate lines:** 100

### 3.6 AI Orchestrator — `src/services/ai-orchestrator.service.ts`

The coordinator that the cron handler calls. It orchestrates the entire flow: read data, evaluate rules, generate messages, dispatch notifications, save to D1. This is the ONLY component that touches D1, KV, and Workers AI bindings directly (through the other services).

```typescript
async function runIntelligentMonitoringCycle(env: Env): Promise<MonitoringCycleResult>

interface MonitoringCycleResult {
  organizationId: string;
  rulesEvaluated: number;
  alertsTriggered: number;
  notificationsSent: number;
  notificationsFailed: number;
  cycleDurationMs: number;
}
```

**Step-by-step flow (inside `runIntelligentMonitoringCycle`):**

1. Read all organizations from D1 (`organizations` table)
2. For each organization:
   a. Read active alert rules: `SELECT * FROM alert_rules WHERE organization_id = ? AND enabled = true`
   b. Read recent hourly averages (last 3 hours): `SELECT * FROM hourly_averages WHERE organization_id = ? AND hour_bucket >= ?`
   c. Read daily summaries (last 7 days): `SELECT * FROM daily_summaries WHERE organization_id = ?`
   d. Read raw telemetry from KV for streak evaluation (last hour): `TELEMETRY_RAW.list({ prefix: "telemetry:{orgId}:" })`
   e. Call `evaluateRules(rules, telemetry, hourly, daily, evaluationTimestamp)`
   f. For each triggered rule, call `generateAlertMessage(env, input)`
   g. Create `alerts` record in D1
   h. Create `alert_lifecycle` record in D1 (status: `active`)
   i. Write `alert_audit_log` entry (action: `triggered`, performedBy: null — system)
   j. Read escalation contacts from `organization_members` where org matches and role is `admin` or `user`
   k. Call `dispatchNotifications(env, input)`
   l. Write escalation records to `alert_escalations` for each dispatched channel
3. Log cycle summary

**Important:** The orchestrator processes organizations sequentially, not in parallel. This avoids D1 write contention within a single Worker invocation. If throughput becomes an issue, organizations can be sharded across multiple cron invocations using KV-based partitioning.

**Approximate lines:** 170

---

## 4. Data Model

### 4.1 New Table: `alerts`

This is the primary alert event record. It captures what happened, the AI-generated message, and which channels were used. It links to the existing `alert_lifecycle` table for state management.

```typescript
// src/schema/alerts.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { devices } from "./devices";
import { deviceSensors } from "./device-sensors";
import { alertRules } from "./alert-rules";

export const alertRuleTypeEnum = text("rule_type", {
  enum: ["critical_threshold", "y2_differential", "consecutive_streak", "std_deviation"],
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id),
  sensorId: text("sensor_id").references(() => deviceSensors.id),
  severity: text("severity", { enum: ["p0", "p1", "p2", "p3"] }).notNull(),
  ruleType: alertRuleTypeEnum.notNull(),
  alertRuleId: text("alert_rule_id").references(() => alertRules.id),
  alertLifecycleId: text("alert_lifecycle_id"),
  currentValue: text("current_value").notNull(), // Stored as string to preserve precision
  thresholdValue: text("threshold_value").notNull(), // Stored as string to preserve precision
  message: text("message").notNull(),
  aiContext: text("ai_context"), // JSON: { recommendation, probableCause, suggestedAction }
  channels: text("channels").notNull(), // JSON: ["whatsapp", "sms", "email", "push"]
  acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

**Design decisions:**
- `currentValue` and `thresholdValue` stored as TEXT, not REAL, to avoid IEEE 754 floating point precision loss (critical for Y2 differential calculations where 0.1°C matters)
- `alertRuleId` is nullable because some system-level rules (Y2 differential) may not correspond to a user-defined alert rule
- `alertLifecycleId` links to the existing `alert_lifecycle` table for state management (ack, shelve, escalate)
- `aiContext` is nullable — if Workers AI fails, the fallback template message has no AI context
- `channels` is a JSON array stored as text — matches existing `alert_rules.channels` pattern

### 4.2 Migration: Extend `alert_lifecycle` with `alertId` FK

```typescript
// Migration: add alert_id column to alert_lifecycle
// ALTER TABLE alert_lifecycle ADD COLUMN alert_id TEXT REFERENCES alerts(id);
```

This creates a bidirectional link: `alerts.alertLifecycleId` <-> `alert_lifecycle.alertId`. The orchestrator creates both records in the same transaction to maintain referential integrity.

### 4.3 Migration: Extend `alertConditionOperatorEnum`

The existing `condition_operator` enum in `alert_rules` supports basic comparisons. Phase 4 adds three new operators for industrial rules:

| Operator | Meaning | Used by |
|----------|---------|---------|
| `streak_gte` | N consecutive readings out of range (threshold_value = streak count) | P2 |
| `stddev_gt` | Standard deviation exceeds threshold (threshold_value = stddev limit) | P3 |
| `diff_lt` | Differential below deadband (threshold_value = setpoint, deadband_value = differential) | P1 |

```typescript
// Updated enum in alert-rules.ts
export const alertConditionOperatorEnum = text("condition_operator", {
  enum: ["gt", "lt", "gte", "lte", "eq", "between", "streak_gte", "stddev_gt", "diff_lt"],
});
```

### 4.4 New Table: `push_subscriptions`

Stores browser push subscription endpoints for Web Push notifications.

```typescript
// src/schema/push-subscriptions.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizationMembers } from "./organization-members";

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  memberId: text("member_id").notNull().references(() => organizationMembers.id),
  endpoint: text("endpoint").notNull(),
  p256dhKey: text("p256dh_key").notNull(), // Client public key (Base64)
  authKey: text("auth_key").notNull(),      // Auth secret (Base64)
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

### 4.5 Schema Index Update — `src/schema/index.ts`

Add the new schemas to the barrel export:

```typescript
export { alerts, alertRuleTypeEnum } from "./alerts";
export { pushSubscriptions } from "./push-subscriptions";
export { memberProfiles } from "./member-profiles";
```

### 4.6 New Table: `member_profiles`

The `organization_members` table only stores role and status — it has NO contact data (phone numbers, emails, or names). Notification dispatch requires recipient contact info, so this new table stores it per member.

```typescript
// src/schema/member-profiles.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { organizationMembers } from "./organization-members";

export const memberProfiles = sqliteTable("member_profiles", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => organizationMembers.id),
  organizationId: text("organization_id").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  whatsappNumber: text("whatsapp_number"),
  smsNumber: text("sms_number"),
  preferredChannel: text("preferred_channel", { enum: ["whatsapp", "sms", "email", "push"] }).default("email"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
```

**Design decisions:**
- `memberId` references `organization_members.id` — one profile per member
- `organizationId` is denormalized for org-scoped queries (avoids JOINing back to `organization_members` just to filter by org)
- `preferredChannel` defaults to `"email"` as the safest universal channel
- Phone fields are nullable — not all members need WhatsApp or SMS
- This table is populated during member invitation (Phase 3 AUTH) or via a profile management endpoint (Phase 6 UI)

---

## 5. Rules Engine — Detailed Rule Definitions

### 5.1 P0: Critical Threshold (`condition_operator: "gt" | "lt" | "gte" | "lte"`)

**When to use:** Temperature exceeds critical bounds that risk product safety (e.g., vaccines > 8 deg C, freezers > -15 deg C).

**Evaluation logic:**

```typescript
function evaluateCriticalThreshold(
  readings: TelemetryReading[],
  thresholdValue: number,
  operator: "gt" | "lt" | "gte" | "lte" | "eq" | "between",
  thresholdValueMax?: number,
): ThresholdEvaluationResult {
  // Filter to the most recent reading per (deviceId, sensorId)
  const latestReadings = getLatestReadingsPerSensor(readings);

  const triggeredReadings: ThresholdTrigger[] = [];

  for (const reading of latestReadings) {
    let isTriggered = false;

    switch (operator) {
      case "gt":
        isTriggered = reading.value > thresholdValue;
        break;
      case "lt":
        isTriggered = reading.value < thresholdValue;
        break;
      case "gte":
        isTriggered = reading.value >= thresholdValue;
        break;
      case "lte":
        isTriggered = reading.value <= thresholdValue;
        break;
      case "between":
        isTriggered = reading.value >= thresholdValue
          && reading.value <= (thresholdValueMax ?? thresholdValue);
        break;
    }

    if (isTriggered) {
      triggeredReadings.push({
        deviceId: reading.deviceId,
        sensorId: reading.sensorId,
        value: reading.value,
        threshold: thresholdValue,
        timestamp: reading.timestamp,
      });
    }
  }

  return { triggered: triggeredReadings.length > 0, triggers: triggeredReadings };
}
```

**Example rule:** `condition_operator: "gt"`, `threshold_value: 8.0`, `severity: "p0"` for vaccine cold chain.

### 5.2 P1: Y2 Differential Rule (`condition_operator: "diff_lt"`)

**When to use:** Industrial refrigeration Y2 rule — do NOT activate the compressor if the differential between setpoint and actual temperature is less than the deadband. Activating below deadband causes short-cycling, compressor wear, and energy waste.

**Evaluation logic:**

```typescript
function evaluateY2Differential(
  readings: TelemetryReading[],
  setpoint: number,      // Desired temperature (from thresholdValue)
  deadband: number,      // Minimum differential before activation (from deadbandValue, default 2.0 deg C)
): Y2DifferentialResult {
  const latestReadings = getLatestReadingsPerSensor(readings);

  const triggeredReadings: Y2DifferentialTrigger[] = [];

  for (const reading of latestReadings) {
    const differential = Math.abs(reading.value - setpoint);

    if (differential < deadband) {
      triggeredReadings.push({
        deviceId: reading.deviceId,
        sensorId: reading.sensorId,
        currentValue: reading.value,
        setpoint,
        differential,
        deadband,
        timestamp: reading.timestamp,
        recommendation: "NO activar compresor — diferencial insuficiente",
      });
    }
  }

  return { triggered: triggeredReadings.length > 0, triggers: triggeredReadings };
}
```

**Example rule:** `condition_operator: "diff_lt"`, `threshold_value: 4.0` (setpoint), `deadband_value: 2.0`, `severity: "p1"`.

If current temperature is 5.0 deg C and setpoint is 4.0 deg C, differential = 1.0 deg C < 2.0 deg C deadband -> P1 alert fired.

### 5.3 P2: Consecutive Streak (`condition_operator: "streak_gte"`)

**When to use:** A sensor reading is out of range for N consecutive measurements. A single out-of-range reading may be noise, but consecutive readings indicate a sustained problem.

**Evaluation logic:**

```typescript
function evaluateConsecutiveStreak(
  readings: TelemetryReading[],  // Sorted by timestamp ascending
  minThreshold: number,          // From device_sensors.min_threshold or thresholdValue
  maxThreshold: number,          // From device_sensors.max_threshold or thresholdValueMax
  streakCount: number,           // From thresholdValue (e.g., 3)
): ConsecutiveStreakResult {
  // Group readings by (deviceId, sensorId), sorted by timestamp
  const groupedReadings = groupReadingsBySensor(readings);

  const triggeredSensors: ConsecutiveStreakTrigger[] = [];

  for (const [sensorKey, sensorReadings] of groupedReadings) {
    let currentStreak = 0;
    let streakStartIndex = -1;

    for (let i = 0; i < sensorReadings.length; i++) {
      const reading = sensorReadings[i];
      const isOutOfRange = reading.value < minThreshold || reading.value > maxThreshold;

      if (isOutOfRange) {
        if (currentStreak === 0) streakStartIndex = i;
        currentStreak++;
      } else {
        currentStreak = 0;
      }

      if (currentStreak >= streakCount) {
        triggeredSensors.push({
          deviceId: reading.deviceId,
          sensorId: reading.sensorId,
          streakLength: currentStreak,
          firstOutOfRangeValue: sensorReadings[streakStartIndex].value,
          lastOutOfRangeValue: reading.value,
          minThreshold,
          maxThreshold,
          streakStartTimestamp: sensorReadings[streakStartIndex].timestamp,
          timestamp: reading.timestamp,
        });
        break; // One trigger per sensor is enough
      }
    }
  }

  return { triggered: triggeredSensors.length > 0, triggers: triggeredSensors };
}
```

**Example rule:** `condition_operator: "streak_gte"`, `threshold_value: 3` (3 consecutive), `threshold_value_max: 8.0` (max threshold), `severity: "p2"`.

### 5.4 P3: Standard Deviation (`condition_operator: "stddev_gt"`)

**When to use:** Sensor readings are unstable — high variance indicates potential sensor malfunction, electrical interference, or environmental disturbance even if individual readings are within range.

**Evaluation logic:**

```typescript
function evaluateStandardDeviation(
  hourlyAggregations: HourlyAggregationRow[],  // Last 24 hours of hourly data
  stddevThreshold: number,                     // From thresholdValue (e.g., 1.5 deg C)
): StdDeviationResult {
  const groupedBySensor = groupHourlyBySensor(hourlyAggregations);

  const triggeredSensors: StdDeviationTrigger[] = [];

  for (const [sensorKey, rows] of groupedBySensor) {
    if (rows.length < 3) continue; // Need at least 3 data points for meaningful stddev

    const values = rows.map((row) => row.avgValue);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const computedStdDev = Math.sqrt(variance);

    if (computedStdDev > stddevThreshold) {
      triggeredSensors.push({
        deviceId: rows[0].deviceId,
        sensorId: rows[0].sensorId,
        computedStdDev,
        stddevThreshold,
        mean,
        sampleCount: rows.length,
        timestamp: rows[rows.length - 1].hourBucket.getTime(),
      });
    }
  }

  return { triggered: triggeredSensors.length > 0, triggers: triggeredSensors };
}
```

**Example rule:** `condition_operator: "stddev_gt"`, `threshold_value: 1.5` (deg C), `severity: "p3"`.

### 5.5 Rule Type Mapping

The `ruleType` field in the `alerts` table is derived from the `conditionOperator` of the matched rule:

| condition_operator | ruleType | Severity Default |
|--------------------|----------|-----------------|
| `gt`, `lt`, `gte`, `lte`, `eq`, `between` | `critical_threshold` | P0 |
| `diff_lt` | `y2_differential` | P1 |
| `streak_gte` | `consecutive_streak` | P2 |
| `stddev_gt` | `std_deviation` | P3 |

The severity on the `alert_rules` record overrides the default — a user can configure a `gt` rule as P2 instead of P0 if they want less urgency.

### 5.6 Deduplication

To prevent alert storms, the orchestrator checks for existing active alerts before creating new ones:

- Query `alert_lifecycle` where `status = 'active'` and `alert_rule_id = ?` and `organization_id = ?`
- If an active alert already exists for the same rule within the last hour, skip creation
- The `time_delay_seconds` field on `alert_rules` provides an additional cooldown: do not re-trigger within N seconds of the last alert for the same rule

---

## 6. AI Integration

### 6.1 Workers AI Binding

**wrangler.toml addition:**

```toml
[ai]
binding = "AI"
```

**Env type extension:**

```typescript
// src/types/env.ts — updated
export interface Env {
  DB: D1Database;
  TELEMETRY_RAW: KVNamespace;
  SECRETS_VAULT: KVNamespace;
  ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  AI: Ai; // Workers AI binding
}
```

### 6.2 Model Selection

Primary model: `@cf/meta/llama-3-8b-instruct` — fast, cost-effective, good at structured output.

Fallback model: `@cf/google/gemma-7b-it` — used if Llama 3 returns an error or times out.

The model is selected via a constant in the alert generator, not configurable per org (to control costs):

```typescript
const WORKERS_AI_MODEL_PRIMARY = "@cf/meta/llama-3-8b-instruct";
const WORKERS_AI_MODEL_FALLBACK = "@cf/google/gemma-7b-it";
const WORKERS_AI_TIMEOUT_MS = 5000;
```

### 6.3 Prompt Template

The prompt is constructed in `src/services/alert-generator.service.ts`. It uses a structured format to ensure consistent, parseable output.

```
You are an industrial cold chain monitoring assistant for VILCAMI.
Generate an alert message for the following anomaly detected by the rule engine.

RULE DETAILS:
- Severity: {severity} (P0=critical, P1=high, P2=medium, P3=low)
- Rule Type: {ruleType}
- Device: {deviceName}
- Sensor: {sensorType}
- Organization: {organizationName}

CURRENT READINGS:
- Current value: {currentValue} {unit}
- Threshold: {thresholdValue} {unit}
- Deviation: {deviation} {unit}

Respond in JSON format only:
{
  "message": "Human-readable alert message in Spanish, max 280 characters. Include device name, current value, and what exceeded the threshold.",
  "probableCause": "Most likely cause based on the rule type and readings, one sentence.",
  "recommendedAction": "Specific action to take, one sentence.",
  "urgency": "immediate|within_hour|within_day|informational"
}
```

**Language:** All AI-generated messages are in Spanish (the primary user base is Latin America). The prompt explicitly requests Spanish output.

**Example output for P0 vaccine cold chain breach:**

```json
{
  "message": "ALERTA CRITICA: Camara Fria #3 temperatura 9.2C supera umbral 8.0C. Vacunas en riesgo inmediato.",
  "probableCause": "Falla en compresor o puerta abierta prolongada causando aumento de temperatura.",
  "recommendedAction": "Verificar estado del compresor y cerrar puertas inmediatamente. Considerar reubicar vacunas si temperatura no baja en 15 minutos.",
  "urgency": "immediate"
}
```

### 6.4 Fallback Template

When Workers AI is unavailable, the alert generator produces a deterministic template message:

```typescript
function generateFallbackMessage(input: AlertGenerationInput): AlertGenerationOutput {
  const severityLabel: Record<string, string> = {
    p0: "ALERTA CRITICA",
    p1: "ALERTA ALTA",
    p2: "ALERTA MEDIA",
    p3: "ALERTA INFORMATIVA",
  };

  const message = `${severityLabel[input.severity]}: ${input.deviceName} ` +
    `${input.sensorType} ${input.recentAverage}${input.unit} ` +
    `supera umbral ${input.thresholdValue}${input.unit}`;

  const aiContext = JSON.stringify({
    message,
    probableCause: "No disponible — IA fuera de servicio",
    recommendedAction: "Verificar manualmente el dispositivo y sensores",
    urgency: input.severity === "p0" ? "immediate" : input.severity === "p1" ? "within_hour" : "informational",
    generatedBy: "fallback_template",
  });

  return { message, aiContext };
}
```

### 6.5 AI Context Schema (Zod Validation)

The AI output is validated with Zod before being stored. Invalid AI responses are caught and fall back to the template.

```typescript
// src/validators/ai-context.validator.ts
import { z } from "zod";

export const aiContextValidator = z.object({
  message: z.string().min(1).max(280),
  probableCause: z.string().min(1),
  recommendedAction: z.string().min(1),
  urgency: z.enum(["immediate", "within_hour", "within_day", "informational"]),
}).strict();

export const alertGenerationOutputValidator = z.object({
  message: z.string().min(1).max(500),
  aiContext: z.string().min(1), // JSON string of aiContextValidator shape
}).strict();
```

---

## 7. Notification System

### 7.1 Adapter Pattern

All notification adapters implement the `NotificationAdapter` interface defined in `src/adapters/notification-adapter.interface.ts`. The dispatcher resolves the correct adapter based on the channel name.

```typescript
// src/adapters/notification-adapter.interface.ts
export interface NotificationAdapter {
  send(alert: AlertMessage, recipient: RecipientContact): Promise<SendResult>;
}

export interface AlertMessage {
  alertId: string;
  organizationId: string;
  severity: "p0" | "p1" | "p2" | "p3";
  ruleType: RuleType;
  deviceName: string;
  sensorType: string;
  message: string;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  triggeredAt: Date;
}

export interface RecipientContact {
  memberName: string;       // from member_profiles.full_name
  memberId: string;
  whatsappNumber: string | null;  // from member_profiles.whatsapp_number
  smsNumber: string | null;       // from member_profiles.sms_number
  email: string | null;           // from member_profiles.email
  pushSubscriptionEndpoint: string | null;  // from push_subscriptions.endpoint
  pushP256dhKey: string | null;             // from push_subscriptions.p256dh_key
  pushAuthKey: string | null;               // from push_subscriptions.auth_key
}

export interface SendResult {
  success: boolean;
  channel: "whatsapp" | "sms" | "email" | "push";
  messageId: string | null;
  error: string | null;
}
```

### 7.2 Adapter Registry

The dispatcher uses a simple registry pattern to resolve adapters:

```typescript
// src/adapters/notification-registry.ts
import type { NotificationAdapter } from "./notification-adapter.interface";

export function getNotificationAdapter(
  channel: string,
  env: Env,
): NotificationAdapter | null {
  switch (channel) {
    case "whatsapp":
      return new TwilioNotificationAdapter("whatsapp", env);
    case "sms":
      return new TwilioNotificationAdapter("sms", env);
    case "email":
      return new EmailNotificationAdapter(env);
    case "push":
      return new PushNotificationAdapter(env);
    default:
      console.warn(`[notification] Unknown channel: ${channel}`);
      return null;
  }
}
```

### 7.3 Twilio Channel Details

**Authentication:** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are stored encrypted in KV Vault under key `{orgId}:secret:twilio`. Decrypted at runtime via `decryptValue()` from `kv-vault.util.ts`.

**WhatsApp format:**
- To number format: `whatsapp:+573001112233`
- Message template: Twilio pre-approved template for alert notifications (required for WhatsApp Business API)
- Template variables: `{alert_severity}`, `{device_name}`, `{current_value}`, `{unit}`, `{threshold}`, `{recommended_action}`

**SMS format:**
- To number format: `+573001112233`
- Plain text message (max 160 chars for GSM-7 encoding, concatenated for longer messages)
- Content: `[VILCAMI {severity}] {device_name}: {sensor_type} {current_value}{unit} (umbral {threshold}{unit}). {recommended_action}`

**Rate limiting:** Max 10 messages per org per minute to prevent Twilio cost overruns. The dispatcher tracks sends in a KV key `{orgId}:ratelimit:notifications:{minuteBucket}` with 60-second TTL.

### 7.4 Email Channel Details

**Authentication:** `SENDGRID_API_KEY` stored encrypted in KV Vault under key `{orgId}:secret:sendgrid`. Decrypted at runtime.

**Email template structure:**

```html
Subject: [VILCAMI {severity_label}] {device_name} — {sensor_type} fuera de umbral

<body>
  <div style="border-left: 4px solid {severity_color}; padding: 16px;">
    <h2>{severity_emoji} {severity_label}</h2>
    <p><strong>Dispositivo:</strong> {device_name}</p>
    <p><strong>Sensor:</strong> {sensor_type}</p>
    <p><strong>Valor actual:</strong> {current_value}{unit}</p>
    <p><strong>Umbral:</strong> {threshold_value}{unit}</p>
    <hr>
    <p><strong>Causa probable:</strong> {probable_cause}</p>
    <p><strong>Accion recomendada:</strong> {recommended_action}</p>
    <a href="{acknowledge_url}">Reconocer alerta</a>
  </div>
</body>
```

**Severity colors:**
- P0: `#DC2626` (red)
- P1: `#F59E0B` (amber)
- P2: `#3B82F6` (blue)
- P3: `#6B7280` (gray)

**Rate limiting:** Max 100 emails per org per hour. Tracked via KV key `{orgId}:ratelimit:email:{hourBucket}` with 3600-second TTL.

### 7.5 Push Channel Details

**VAPID keys:** Generated once during project setup. The private key is stored encrypted in KV Vault under key `global:secret:vapid_private`. The public key is embedded in the frontend SPA.

**Web Push protocol:**
1. Encrypt payload with `p256dh` key and `auth` key (ECDH + AES-128-GCM per RFC 8291)
2. Sign VAPID JWT with ECDSA using `crypto.subtle` (P-256 curve, per RFC 8292)
3. Send `POST` to the subscription endpoint with encrypted payload
4. Handle 410 Gone by removing the subscription from `push_subscriptions` table

**Push payload (max 4KB):**

```json
{
  "title": "VILCAMI: {severity_label}",
  "body": "{device_name} — {message}",
  "icon": "/icon-192.png",
  "badge": "/badge-72.png",
  "data": {
    "alertId": "{alert_id}",
    "organizationId": "{org_id}",
    "severity": "{severity}",
    "clickAction": "/dashboard/alerts/{alert_id}"
  },
  "actions": [
    { "action": "acknowledge", "title": "Reconocer" },
    { "action": "view", "title": "Ver detalles" }
  ]
}
```

**TTL headers:**
- P0/P1: `TTL: 86400` (24 hours — must deliver even if device is offline)
- P2/P3: `TTL: 3600` (1 hour — non-critical, skip if device offline for long)

---

## 8. API Endpoints

Phase 4 adds one new route group for alert management. All endpoints require authentication and org-scoping.

### 8.1 Alert Routes — `src/routes/alerts.routes.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | List alerts for the authenticated org (paginated) |
| GET | `/api/alerts/:alertId` | Get alert details with AI context |
| PATCH | `/api/alerts/:alertId/acknowledge` | Acknowledge an alert (sets `acknowledgedAt`, updates lifecycle) |
| PATCH | `/api/alerts/:alertId/resolve` | Resolve an alert (sets `resolvedAt`, updates lifecycle to `returned_to_normal`) |
| POST | `/api/alerts/:alertId/shelve` | Shelve an alert temporarily (sets `shelvedUntil` on lifecycle) |
| GET | `/api/alerts/active/count` | Count of active alerts by severity for the org dashboard |
| POST | `/api/push-subscriptions` | Register a browser push subscription |

### 8.2 Endpoint Specifications

**GET /api/alerts**

```typescript
// Query parameters
const listAlertsQueryValidator = z.object({
  severity: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  status: z.enum(["active", "acknowledged", "resolved"]).optional(),
  deviceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
```

Response: `{ alerts: AlertWithLifecycle[], total: number, limit: number, offset: number }`

**PATCH /api/alerts/:alertId/acknowledge**

```typescript
const acknowledgeAlertValidator = z.object({
  notes: z.string().max(500).optional(),
}).strict();
```

Side effects: Updates `alerts.acknowledgedAt`, sets `alert_lifecycle.status = 'acknowledged'`, writes `alert_audit_log` entry (action: `acknowledged`, performedBy: JWT `sub`).

**POST /api/push-subscriptions**

```typescript
const pushSubscriptionValidator = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }).strict(),
}).strict();
```

Stores the subscription in `push_subscriptions` table, scoped to the authenticated user's organization.

### 8.3 Zod Validators — `src/validators/alert.validator.ts`

```typescript
import { z } from "zod";

export const listAlertsQueryValidator = z.object({
  severity: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  status: z.enum(["active", "acknowledged", "resolved"]).optional(),
  deviceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const acknowledgeAlertValidator = z.object({
  notes: z.string().max(500).optional(),
}).strict();

export const resolveAlertValidator = z.object({
  resolution: z.string().min(1).max(500),
}).strict();

export const shelveAlertValidator = z.object({
  durationMinutes: z.number().int().min(5).max(1440).default(60),
  reason: z.string().min(1).max(200),
}).strict();
```

---

## 9. Cron Flow — Step by Step

The cron handler in `src/index.ts` is extended to call both the existing aggregation cron and the new intelligent monitoring cycle.

```typescript
// src/index.ts — updated scheduled handler
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // Existing: aggregate raw telemetry from KV into D1 hourly/daily tables
    ctx.waitUntil(runHourlyAggregation(env));

    // NEW Phase 4: evaluate rules, generate AI alerts, dispatch notifications
    ctx.waitUntil(runIntelligentMonitoringCycle(env));
  },
};
```

**Both run via `ctx.waitUntil()` — they execute in parallel within the same Worker invocation.** The monitoring cycle depends on aggregation being complete (it reads from `hourly_averages`), but since aggregation writes to D1 synchronously before `ctx.waitUntil()` resolves and the monitoring cycle also queries D1, both will be scheduled. In practice, the monitoring cycle reads data from the previous hour's aggregation (already in D1), so there is no race condition.

### Detailed Cycle Steps

```
1. ENTRY: runIntelligentMonitoringCycle(env)
   |
2. GET all organizations from D1
   |  SELECT id, name, country_code FROM organizations
   |
3. FOR EACH organization:
   |
   3a. GET active alert rules
       |  SELECT * FROM alert_rules
       |  WHERE organization_id = {orgId} AND enabled = true
       |
   3b. SKIP if no active rules — continue to next org
       |
   3c. GET recent hourly averages (last 3 hours)
       |  SELECT * FROM hourly_averages
       |  WHERE organization_id = {orgId}
       |  AND hour_bucket >= {now - 3 hours}
       |
   3d. GET daily summaries (last 7 days)
       |  SELECT * FROM daily_summaries
       |  WHERE organization_id = {orgId}
       |  AND date_bucket >= {now - 7 days}
       |
   3e. GET raw telemetry from KV (last hour, for streak evaluation)
       |  KV.list({ prefix: "telemetry:{orgId}:" })
       |  NOTE: KV keys are stored as telemetry:{orgId}:{deviceId}:{timestamp}:{sensorId}
       |  (see telemetry-ingestion.service.ts), so the per-org prefix is correct.
       |  This differs from the aggregation cron which uses prefix "telemetry:" to list ALL orgs.
       |  Parse each entry from JSON
       |
   3f. EVALUATE rules
       |  evaluateRules(rules, telemetry, hourly, daily, now)
       |  Returns: RuleEvaluationResult[]
       |
   3g. FOR EACH triggered rule:
       |
       3g-i.   CHECK deduplication
              | Query alert_lifecycle for active alerts with same alert_rule_id
              | Skip if alert already active within time_delay_seconds
              |
       3g-ii.  GENERATE AI message
              | generateAlertMessage(env, input)
              | Falls back to template on AI failure
              |
       3g-iii. CREATE alert record in D1
              | INSERT INTO alerts (id, organization_id, device_id, sensor_id,
              |   severity, rule_type, alert_rule_id, current_value, threshold_value,
              |   message, ai_context, channels, created_at)
              |
       3g-iv.  CREATE lifecycle record in D1
              | INSERT INTO alert_lifecycle (id, organization_id, alert_rule_id,
              |   alert_id, status, triggered_at)
              | status = 'active'
              |
       3g-v.   CREATE audit log entry
              | INSERT INTO alert_audit_log (id, organization_id, alert_lifecycle_id,
              |   action, performed_by, timestamp, details)
              | action = 'triggered', performed_by = null (system)
              |
       3g-vi.  UPDATE alerts.alertLifecycleId with the created lifecycle ID
              | UPDATE alerts SET alert_lifecycle_id = {lifecycleId}
              | WHERE id = {alertId}
              |
              | **IMPORTANT:** Steps 3g-iii through 3g-vi MUST be executed within a D1 batch
              | to ensure atomicity. If any step fails, the entire batch rolls back.
              |
       3g-vii. GET notification recipients
              | SELECT om.id, om.supabase_user_id FROM organization_members om
              | WHERE om.organization_id = {orgId} AND om.status = 'active'
              | JOIN with member_profiles for phone/email/name
              | JOIN with push_subscriptions for push endpoints
              |
       3g-viii. DISPATCH notifications
              | dispatchNotifications(env, input)
              | Uses adapter registry for each channel
              | Respects per-org rate limits (KV TTL counters)
              |
       3g-ix.  RECORD escalations
              | INSERT INTO alert_escalations for each dispatched notification
              | (escalation_level, channel, sent_at)
              |
   3h. LOG cycle result for this org
       | console.log(`[monitoring] Org ${orgId}: ${evaluated} rules, ${triggered} alerts, ${sent} notifications`)
       |
       **Error handling:** Each organization's processing is wrapped in try/catch. If one org fails,
       the error is logged and the cycle continues to the next org. The monitoring cycle MUST NOT
       abort entirely because one org's rules fail.
       |
4. RETURN: MonitoringCycleResult summary
```

---

## 10. Testing Strategy

### 10.1 TDD Approach

Every function follows the VILCAMI TDD cycle:
1. Write the test for the pure function first
2. Run the test — it must fail (red)
3. Write the minimum implementation to pass (green)
4. Refactor if needed (no behavior change)

### 10.2 Test File Structure

```
src/test/
  services/
    rule-engine.helpers.test.ts     -- Pure function unit tests
    rule-engine.service.test.ts      -- Integration with mock data
    alert-generator.service.test.ts  -- Workers AI mock tests
    notification-dispatcher.test.ts  -- Adapter registry + dispatch logic
    ai-orchestrator.service.test.ts  -- Full cycle with D1 mock
  adapters/
    notification-twilio.adapter.test.ts
    notification-email.adapter.test.ts
    notification-push.adapter.test.ts
  routes/
    alerts.routes.test.ts
  validators/
    ai-context.validator.test.ts
    alert.validator.test.ts
  schema/
    alerts.test.ts
```

### 10.3 Rule Engine Tests (Critical Path)

**File:** `src/test/services/rule-engine.helpers.test.ts`

These are pure function tests — no mocks, no D1, no KV. Deterministic inputs and outputs.

```typescript
describe("evaluateCriticalThreshold", () => {
  it("triggers P0 when temperature exceeds 8C threshold", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 9.2, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateCriticalThreshold(readings, 8.0, "gt");
    expect(result.triggered).toBe(true);
    expect(result.triggers[0].value).toBe(9.2);
  });

  it("does not trigger when value is exactly at threshold with gt operator", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 8.0, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateCriticalThreshold(readings, 8.0, "gt");
    expect(result.triggered).toBe(false);
  });

  it("triggers with gte operator when value equals threshold", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 8.0, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateCriticalThreshold(readings, 8.0, "gte");
    expect(result.triggered).toBe(true);
  });
});

describe("evaluateY2Differential", () => {
  it("triggers P1 when differential is below 2C deadband", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 5.0, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateY2Differential(readings, 4.0, 2.0);
    expect(result.triggered).toBe(true);
    expect(result.triggers[0].differential).toBe(1.0);
  });

  it("does not trigger when differential equals deadband exactly", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 6.0, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateY2Differential(readings, 4.0, 2.0);
    expect(result.triggered).toBe(false);
  });

  it("does not trigger when differential exceeds deadband", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 7.5, unit: "C", organizationId: "org-1", timestamp: Date.now() },
    ];
    const result = evaluateY2Differential(readings, 4.0, 2.0);
    expect(result.triggered).toBe(false);
  });
});

describe("evaluateConsecutiveStreak", () => {
  it("triggers P2 after 3 consecutive out-of-range readings", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 10.0, unit: "C", organizationId: "org-1", timestamp: 1000 },
      { deviceId: "dev-1", sensorId: "temp-1", value: 10.5, unit: "C", organizationId: "org-1", timestamp: 2000 },
      { deviceId: "dev-1", sensorId: "temp-1", value: 11.0, unit: "C", organizationId: "org-1", timestamp: 3000 },
    ];
    const result = evaluateConsecutiveStreak(readings, -10, 8, 3);
    expect(result.triggered).toBe(true);
    expect(result.triggers[0].streakLength).toBe(3);
  });

  it("does not trigger if streak is broken by an in-range reading", () => {
    const readings = [
      { deviceId: "dev-1", sensorId: "temp-1", value: 10.0, unit: "C", organizationId: "org-1", timestamp: 1000 },
      { deviceId: "dev-1", sensorId: "temp-1", value: 5.0, unit: "C", organizationId: "org-1", timestamp: 2000 },
      { deviceId: "dev-1", sensorId: "temp-1", value: 10.5, unit: "C", organizationId: "org-1", timestamp: 3000 },
    ];
    const result = evaluateConsecutiveStreak(readings, -10, 8, 3);
    expect(result.triggered).toBe(false);
  });
});

describe("evaluateStandardDeviation", () => {
  it("triggers P3 when computed stddev exceeds threshold", () => {
    const hourlyRows = [
      { deviceId: "dev-1", sensorId: "temp-1", avgValue: 2.0, minValue: 1, maxValue: 3, sampleCount: 10, hourBucket: new Date("2026-05-10T08:00:00Z"), organizationId: "org-1" },
      { deviceId: "dev-1", sensorId: "temp-1", avgValue: 8.0, minValue: 7, maxValue: 9, sampleCount: 10, hourBucket: new Date("2026-05-10T09:00:00Z"), organizationId: "org-1" },
      { deviceId: "dev-1", sensorId: "temp-1", avgValue: 5.0, minValue: 4, maxValue: 6, sampleCount: 10, hourBucket: new Date("2026-05-10T10:00:00Z"), organizationId: "org-1" },
    ];
    const result = evaluateStandardDeviation(hourlyRows, 1.5);
    expect(result.triggered).toBe(true);
  });

  it("does not trigger with fewer than 3 data points", () => {
    const hourlyRows = [
      { deviceId: "dev-1", sensorId: "temp-1", avgValue: 2.0, minValue: 1, maxValue: 3, sampleCount: 10, hourBucket: new Date(), organizationId: "org-1" },
      { deviceId: "dev-1", sensorId: "temp-1", avgValue: 8.0, minValue: 7, maxValue: 9, sampleCount: 10, hourBucket: new Date(), organizationId: "org-1" },
    ];
    const result = evaluateStandardDeviation(hourlyRows, 1.5);
    expect(result.triggered).toBe(false);
  });
});

describe("isWithinMaintenanceWindow", () => {
  it("returns true when current time is within window", () => {
    const now = new Date("2026-05-10T14:30:00Z");
    const start = new Date("2026-05-10T14:00:00Z");
    const end = new Date("2026-05-10T15:00:00Z");
    expect(isWithinMaintenanceWindow(now, start, end)).toBe(true);
  });

  it("returns false when current time is outside window", () => {
    const now = new Date("2026-05-10T16:00:00Z");
    const start = new Date("2026-05-10T14:00:00Z");
    const end = new Date("2026-05-10T15:00:00Z");
    expect(isWithinMaintenanceWindow(now, start, end)).toBe(false);
  });

  it("returns false when maintenance window is null", () => {
    const now = new Date();
    expect(isWithinMaintenanceWindow(now, null, null)).toBe(false);
  });
});
```

### 10.4 Alert Generator Tests

**File:** `src/test/services/alert-generator.service.test.ts`

Uses a mock `env.AI` that returns predetermined responses.

```typescript
describe("generateAlertMessage", () => {
  it("returns AI-generated message when Workers AI responds successfully", async () => {
    const mockEnv = { AI: { run: vi.fn().mockResolvedValue({ response: "..." }) } };
    const result = await generateAlertMessage(mockEnv, mockInput);
    expect(result.message).toBeTruthy();
    expect(result.aiContext).toBeTruthy();
  });

  it("falls back to template when Workers AI throws an error", async () => {
    const mockEnv = { AI: { run: vi.fn().mockRejectedValue(new Error("AI timeout")) } };
    const result = await generateAlertMessage(mockEnv, mockInput);
    expect(result.message).toContain("ALERTA CRITICA");
    const context = JSON.parse(result.aiContext);
    expect(context.generatedBy).toBe("fallback_template");
  });

  it("falls back to template when Workers AI returns invalid JSON", async () => {
    const mockEnv = { AI: { run: vi.fn().mockResolvedValue({ response: "not json" }) } };
    const result = await generateAlertMessage(mockEnv, mockInput);
    expect(result.aiContext).toContain("fallback_template");
  });

  it("validates AI output against aiContextValidator", async () => {
    // Ensures malformed AI responses are caught and don't corrupt the alerts table
  });
});
```

### 10.5 Notification Adapter Tests

**File:** `src/test/adapters/notification-twilio.adapter.test.ts`

Uses `fetch` mocking to test Twilio API calls without real HTTP requests.

```typescript
describe("TwilioNotificationAdapter", () => {
  it("sends WhatsApp message with correct format", async () => {
    // Verify: POST to Twilio API, To field starts with "whatsapp:+"
  });

  it("sends SMS with correct format", async () => {
    // Verify: POST to Twilio API, To field is plain phone number
  });

  it("decrypts Twilio credentials from KV Vault", async () => {
    // Verify: reads from SECRETS_VAULT, decrypts, uses as auth
  });

  it("returns SendResult with success=false on Twilio API error", async () => {
    // Verify: error is captured, not thrown
  });

  it("respects rate limit — returns failure when exceeded", async () => {
    // Verify: KV rate limit key checked before sending
  });
});
```

### 10.6 Orchestrator Integration Test

**File:** `src/test/services/ai-orchestrator.service.test.ts`

Uses `miniflare` or `vitest` with D1/KV mocks to test the full cycle.

```typescript
describe("runIntelligentMonitoringCycle", () => {
  it("creates alert records and lifecycle entries for triggered rules", async () => {
    // Setup: seed D1 with org, device, sensor, alert rule, hourly_averages
    // Run: call runIntelligentMonitoringCycle(env)
    // Assert: alerts table has new entry, alert_lifecycle has active entry
  });

  it("skips rules within maintenance window", async () => {
    // Setup: alert rule with maintenance window covering current time
    // Run: call runIntelligentMonitoringCycle(env)
    // Assert: no alerts created
  });

  it("skips disabled rules", async () => {
    // Setup: alert rule with enabled = false
    // Assert: no alerts created
  });

  it("deduplicates — does not create alert if active alert exists for same rule", async () => {
    // Setup: existing active alert_lifecycle for the rule
    // Assert: no duplicate alert created
  });
});
```

### 10.7 Test Execution Order

1. `rule-engine.helpers.test.ts` — pure functions, no dependencies
2. `rule-engine.service.test.ts` — depends on helpers
3. `ai-context.validator.test.ts` — Zod schema validation
4. `alert.validator.test.ts` — API input validation
5. `alert-generator.service.test.ts` — depends on validators
6. `notification-twilio.adapter.test.ts` — adapter unit tests
7. `notification-email.adapter.test.ts` — adapter unit tests
8. `notification-push.adapter.test.ts` — adapter unit tests
9. `notification-dispatcher.test.ts` — depends on adapters
10. `alerts.routes.test.ts` — API endpoint tests
11. `ai-orchestrator.service.test.ts` — full integration
12. `alerts.test.ts` — schema/D1 validation

---

## 11. Environment & Configuration

### 11.1 wrangler.toml Additions

```toml
# Workers AI binding
[ai]
binding = "AI"
```

### 11.2 Secrets (Stored in KV Vault, NOT in wrangler.toml)

| Secret | KV Key | Used By |
|--------|--------|---------|
| `TWILIO_ACCOUNT_SID` | `{orgId}:secret:twilio_sid` | Twilio adapter |
| `TWILIO_AUTH_TOKEN` | `{orgId}:secret:twilio_auth` | Twilio adapter |
| `TWILIO_PHONE_NUMBER` | `{orgId}:secret:twilio_phone` | Twilio adapter |
| `SENDGRID_API_KEY` | `{orgId}:secret:sendgrid_key` | Email adapter |
| `VAPID_PRIVATE_KEY` | `global:secret:vapid_private` | Push adapter |

Secrets are set per organization because each org may use different Twilio/SendGrid accounts. The VAPID private key is global (same for all orgs).

### 11.3 Env Type Update — `src/types/env.ts`

```typescript
export interface Env {
  DB: D1Database;
  TELEMETRY_RAW: KVNamespace;
  SECRETS_VAULT: KVNamespace;
  ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  AI: Ai; // Workers AI binding (new in Phase 4)
}
```

### 11.4 KV Rate Limit Keys (Ephemeral)

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `{orgId}:ratelimit:notifications:{minuteBucket}` | 60s | Twilio send rate limit (10/min) |
| `{orgId}:ratelimit:email:{hourBucket}` | 3600s | Email send rate limit (100/hour) |

### 11.5 Workers AI Configuration Constants

```typescript
// src/services/alert-generator.service.ts
const WORKERS_AI_MODEL_PRIMARY = "@cf/meta/llama-3-8b-instruct";
const WORKERS_AI_MODEL_FALLBACK = "@cf/google/gemma-7b-it";
const WORKERS_AI_TIMEOUT_MS = 5000;
const WORKERS_AI_MAX_RETRIES = 1; // One retry before fallback
```

---

## 12. File Structure

All files with estimated line counts. Every file follows the 200-line maximum convention.

```
src/
  schema/
    alerts.ts                                    (~50 lines) NEW
    push-subscriptions.ts                        (~25 lines) NEW
    member-profiles.ts                            (~30 lines) NEW
    index.ts                                     (~18 lines) MODIFY — add exports
  
  services/
    rule-engine.service.ts                       (~120 lines) NEW
    rule-engine.helpers.ts                       (~190 lines) NEW
    alert-generator.service.ts                   (~100 lines) NEW
    notification-dispatcher.service.ts            (~130 lines) NEW
    ai-orchestrator.service.ts                   (~170 lines) NEW
  
  adapters/
    notification-adapter.interface.ts             (~60 lines)  NEW
    notification-twilio.adapter.ts               (~80 lines)  NEW
    notification-email.adapter.ts                (~90 lines)  NEW
    notification-push.adapter.ts                 (~100 lines) NEW
    notification-registry.ts                      (~25 lines)  NEW
  
  validators/
    alert.validator.ts                            (~50 lines)  NEW
    ai-context.validator.ts                       (~25 lines)  NEW
  
  routes/
    alerts.routes.ts                              (~150 lines) NEW
  
  types/
    env.ts                                        (~10 lines) MODIFY — add AI binding
  
  index.ts                                        (~120 lines) MODIFY — add monitoring cron
  
  test/
    services/
      rule-engine.helpers.test.ts                 (~200 lines) NEW
      rule-engine.service.test.ts                 (~120 lines) NEW
      alert-generator.service.test.ts             (~100 lines) NEW
      notification-dispatcher.test.ts             (~120 lines) NEW
      ai-orchestrator.service.test.ts             (~150 lines) NEW
    
    adapters/
      notification-twilio.adapter.test.ts        (~100 lines) NEW
      notification-email.adapter.test.ts         (~90 lines)  NEW
      notification-push.adapter.test.ts          (~110 lines) NEW
    
    routes/
      alerts.routes.test.ts                       (~150 lines) NEW
    
    validators/
      alert.validator.test.ts                     (~60 lines)  NEW
      ai-context.validator.test.ts                (~50 lines)  NEW
    
    schema/
      alerts.test.ts                              (~50 lines)  NEW
```

**Total new files:** 23
**Total modified files:** 3 (env.ts, index.ts, schema/index.ts)
**Total estimated lines of new code:** ~2,800
**Total estimated lines of tests:** ~1,100

---

## Appendix A: Drizzle Migration Reference

The following migration adds the `alerts` table, `push_subscriptions` table, `member_profiles` table, extends the `alert_rules.condition_operator` enum, and adds the `alert_id` column to `alert_lifecycle`. The migration file is created by Drizzle Kit and should NOT be written manually — this section documents the expected changes for reference only.

```sql
-- New table: alerts
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  sensor_id TEXT REFERENCES device_sensors(id),
  severity TEXT NOT NULL CHECK(severity IN ('p0', 'p1', 'p2', 'p3')),
  rule_type TEXT NOT NULL CHECK(rule_type IN ('critical_threshold', 'y2_differential', 'consecutive_streak', 'std_deviation')),
  alert_rule_id TEXT REFERENCES alert_rules(id),
  alert_lifecycle_id TEXT,
  current_value TEXT NOT NULL,
  threshold_value TEXT NOT NULL,
  message TEXT NOT NULL,
  ai_context TEXT,
  channels TEXT NOT NULL,
  acknowledged_at INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Index for org-scoped queries
CREATE INDEX idx_alerts_organization_id ON alerts(organization_id);
CREATE INDEX idx_alerts_device_id ON alerts(device_id);
CREATE INDEX idx_alerts_severity ON alerts(organization_id, severity);
CREATE INDEX idx_alerts_created_at ON alerts(organization_id, created_at);

-- New table: push_subscriptions
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES organization_members(id),
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_push_subscriptions_org ON push_subscriptions(organization_id);
CREATE INDEX idx_push_subscriptions_member ON push_subscriptions(member_id);

-- New table: member_profiles (contact data for notification recipients)
CREATE TABLE member_profiles (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES organization_members(id),
  organization_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  whatsapp_number TEXT,
  sms_number TEXT,
  preferred_channel TEXT DEFAULT 'email',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_member_profiles_org ON member_profiles(organization_id);
CREATE INDEX idx_member_profiles_member ON member_profiles(member_id);

-- Extend alert_lifecycle with alert_id reference
ALTER TABLE alert_lifecycle ADD COLUMN alert_id TEXT REFERENCES alerts(id);

-- Note: SQLite does not support ALTER COLUMN for enum constraints.
-- The condition_operator enum extension is handled at the Drizzle schema level.
-- Existing rows with old enum values remain valid.
-- New rows can use 'streak_gte', 'stddev_gt', 'diff_lt'.
```

---

## Appendix B: Security Checklist for Phase 4

- [ ] All D1 queries scoped with `eq(table.organizationId, jwtOrganizationId)` or `eq(table.organizationId, orgId)` in cron
- [ ] No secrets in plaintext — Twilio, SendGrid, VAPID keys encrypted in KV Vault
- [ ] Zod validation on every API input (alert routes, push subscriptions)
- [ ] AI output validated with `aiContextValidator` before storage — prevents injection
- [ ] Notification rate limits prevent cost overruns (Twilio: 10/min, Email: 100/hour)
- [ ] Push subscription endpoints validated as URLs before storage
- [ ] Web Crypto only — no `Buffer.from` for crypto operations
- [ ] VAPID JWT signed with `crypto.subtle` ECDSA, not Node.js `jsonwebtoken`
- [ ] Maintenance window support prevents alert fatigue during planned downtime
- [ ] Deduplication prevents alert storms from repeated rule triggers
- [ ] AI fallback template ensures alerts are NEVER lost due to AI unavailability
- [ ] `alert_audit_log` entries are INSERT-only (immutable) — HACCP/INVIMA compliance

---

## Appendix C: What is NOT in Phase 4

These items are explicitly out of scope and belong to future phases:

- **PDF compliance report generation** — Phase 4 generates alerts only, not formal compliance documents
- **Predictive analytics / anomaly detection via AI** — Phase 4 rules are deterministic; future phase may add ML-based anomaly detection
- **Auto-remediation (device commands triggered by rules)** — Phase 4 detects and alerts only; auto-remediation requires Phase 2 (IoT) command support
- **User-facing dashboard for alert visualization** — Phase 6 (UI)
- **Custom AI model training** — Phase 4 uses pre-trained Workers AI models only
- **WebSocket real-time alert streaming** — Future; Phase 4 uses push notifications for real-time delivery
- **Multi-language AI messages** — Phase 4 generates Spanish only; locale support is future work