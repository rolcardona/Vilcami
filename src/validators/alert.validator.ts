import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enum constants — aligned with Drizzle schema definitions
// ---------------------------------------------------------------------------
const alertSeverityValues = ["p0", "p1", "p2", "p3"] as const;

const alertLifecycleStatusValues = [
  "active",
  "acknowledged",
  "returned_to_normal",
  "shelved",
  "suppressed",
  "out_of_service",
] as const;

// ---------------------------------------------------------------------------
// Alert Rule — creation / update of alert rules (existing)
// ---------------------------------------------------------------------------
export const alertRuleValidator = z.object({
  organizationId: z.string().min(1),
  deviceId: z.string().optional(),
  sensorId: z.string().optional(),
  ruleName: z.string().min(1).max(200),
  severity: z.enum(alertSeverityValues),
  conditionOperator: z.enum(["gt", "lt", "gte", "lte", "eq", "between", "streak_gte", "stddev_gt", "diff_lt"]),
  thresholdValue: z.number(),
  thresholdValueMax: z.number().optional(),
  deadbandValue: z.number().default(2.0),
  timeDelaySeconds: z.number().int().min(0).default(0),
  channels: z.array(z.enum(["whatsapp", "push", "sms", "email"])).min(1),
  enabled: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.conditionOperator === "between") {
      return data.thresholdValueMax !== undefined && data.thresholdValueMax > data.thresholdValue;
    }
    return true;
  },
  { message: "thresholdValueMax is required and must be greater than thresholdValue when operator is 'between'", path: ["thresholdValueMax"] }
);

// ---------------------------------------------------------------------------
// List Alerts — GET /api/alerts with pagination and filters
// ---------------------------------------------------------------------------
export const listAlertsValidator = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  severity: z.enum(alertSeverityValues).optional(),
  status: z.enum(alertLifecycleStatusValues).optional(),
  deviceId: z.string().min(1).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Acknowledge Alert — POST /api/alerts/:id/acknowledge
// ---------------------------------------------------------------------------
export const acknowledgeAlertValidator = z.object({
  acknowledgmentNotes: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Resolve Alert — POST /api/alerts/:id/resolve
// ---------------------------------------------------------------------------
export const resolveAlertValidator = z.object({
  resolutionNotes: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Shelve Alert — POST /api/alerts/:id/shelve
// ---------------------------------------------------------------------------
export const shelveAlertValidator = z.object({
  shelvedUntilTimestamp: z.number().int().positive(),
  shelvingReason: z.string().min(1),
}).strict();

// ---------------------------------------------------------------------------
// Push Subscription — POST /api/alerts/subscriptions
// ---------------------------------------------------------------------------
export const pushSubscriptionValidator = z.object({
  endpoint: z.string().url(),
  p256dhKey: z.string().min(1),
  authKey: z.string().min(1),
}).strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ListAlertsInput = z.infer<typeof listAlertsValidator>;
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertValidator>;
export type ResolveAlertInput = z.infer<typeof resolveAlertValidator>;
export type ShelveAlertInput = z.infer<typeof shelveAlertValidator>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionValidator>;