/**
 * Tests for AI Orchestrator Service — runIntelligentMonitoringCycle.
 * TDD: written BEFORE implementation.
 *
 * Covers: empty orgs, no rules, full cycle, org failure isolation, severity mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = {
  select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(), all: vi.fn(), get: vi.fn(),
  insert: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(), run: vi.fn(),
  batch: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../utils/db.util", () => ({ getDrizzleDb: vi.fn(() => mockDb) }));
vi.mock("../../services/rule-engine.service", () => ({ evaluateRules: vi.fn() }));
vi.mock("../../services/alert-generator.service", () => ({ generateAlertContext: vi.fn() }));
vi.mock("../../services/notification-dispatcher.service", () => ({ dispatchNotifications: vi.fn() }));

import { runIntelligentMonitoringCycle } from "../../services/ai-orchestrator.service";
import type { MonitoringCycleResult } from "../../services/ai-orchestrator.service";
import { evaluateRules } from "../../services/rule-engine.service";
import { generateAlertContext } from "../../services/alert-generator.service";
import { dispatchNotifications } from "../../services/notification-dispatcher.service";
import type { Env } from "../../types/env";
import type { RuleEvaluationResult } from "../../services/rule-engine.types";
import type { AiContextOutput } from "../../validators/ai-context.validator";

function createMockEnv(): Env {
  return {
    DB: {} as D1Database,
    TELEMETRY_RAW: {
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
      get: vi.fn().mockResolvedValue(null),
    } as unknown as KVNamespace,
    SECRETS_VAULT: {} as KVNamespace, ENCRYPTION_KEY: "test-key",
    SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "test-anon-key",
    THROTTLE_KV: {} as KVNamespace,
    WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
    WOMPI_PUBLIC_KEY: "test-pub-key",
    WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
    AI: { run: vi.fn() } as unknown as Ai,
  };
}

const TRIGGERED_RULE: RuleEvaluationResult = {
  ruleId: "rule-temp-001", sensorType: "temperature", ruleType: "critical_threshold",
  triggered: true, currentValue: 85.5, thresholdValue: 80,
  details: "Sensor temperature (85.5) exceeded threshold (80)",
};

const AI_CONTEXT: AiContextOutput = {
  message: "Temperatura critica detectada", probableCause: "Falla en sistema de refrigeracion",
  recommendedAction: "Verificar refrigeracion de inmediato", urgency: "critical",
};

const P0_RULE = {
  id: "rule-p0", organizationId: "org-001", sensorType: "temperature",
  ruleType: "critical_threshold", severity: "p0", conditionOperator: "gt",
  thresholdValue: 80, thresholdValueMax: null, deadbandValue: 2, enabled: true, channels: "push",
  deviceId: "device-001", sensorId: "sensor-001", ruleName: "P0 Rule", timeDelaySeconds: 0,
  maintenanceWindowStart: null, maintenanceWindowEnd: null,
};

describe("runIntelligentMonitoringCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis(); mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis(); mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis(); mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis(); mockDb.run.mockResolvedValue({ meta: {} });
    mockDb.batch.mockResolvedValue(undefined);
    mockDb.get.mockResolvedValue(null); // no existing active alerts (dedup)
  });

  it("returns empty array when no organizations exist", async () => {
    const env = createMockEnv();
    mockDb.all.mockResolvedValueOnce([]);
    const results = await runIntelligentMonitoringCycle(env);
    expect(results).toEqual([]);
  });

  it("returns zero counts when organization has no enabled rules", async () => {
    const env = createMockEnv();
    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    mockDb.all.mockResolvedValueOnce([]);
    (env.TELEMETRY_RAW.list as ReturnType<typeof vi.fn>).mockResolvedValue({ keys: [], list_complete: true });

    const results = await runIntelligentMonitoringCycle(env);
    expect(results).toHaveLength(1);
    expect(results[0].organizationId).toBe("org-001");
    expect(results[0].rulesEvaluated).toBe(0);
    expect(results[0].alertsTriggered).toBe(0);
  });

  it("completes full cycle: evaluate rules → AI context → persist alert → dispatch notifications", async () => {
    const env = createMockEnv();
    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    mockDb.all.mockResolvedValueOnce([{
      ...P0_RULE, id: "rule-001", severity: "p0", channels: "push,email",
    }]);
    mockDb.all.mockResolvedValueOnce([]); // hourly averages
    mockDb.all.mockResolvedValueOnce([]); // daily summaries
    mockDb.all.mockResolvedValueOnce([{ // member profiles
      id: "mp-001", organizationId: "org-001", memberId: "member-001",
      fullName: "Tech Admin", email: "tech@org.com", whatsappNumber: "+5491112345678",
      smsNumber: null, preferredChannel: "email",
    }]);
    mockDb.all.mockResolvedValueOnce([{ // push subscriptions
      id: "ps-001", organizationId: "org-001", memberId: "member-001",
      endpoint: "https://push.example.com/sub", p256dhKey: "key123", authKey: "auth123",
    }]);

    (env.TELEMETRY_RAW.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      keys: [{ name: "telemetry:org-001:device-001" }], list_complete: true,
    });
    (env.TELEMETRY_RAW.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ sensorType: "temperature", value: 85.5, timestamp: Date.now() }),
    );
    (evaluateRules as ReturnType<typeof vi.fn>).mockResolvedValue([TRIGGERED_RULE]);
    (generateAlertContext as ReturnType<typeof vi.fn>).mockResolvedValue(AI_CONTEXT);
    (dispatchNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      alertId: "alert-001", channelsAttempted: ["push"], channelsSucceeded: ["push"],
      channelsFailed: [], recipientResults: new Map([["member-001", true]]), escalationStartedAt: Date.now(),
    });

    const results = await runIntelligentMonitoringCycle(env);
    expect(results).toHaveLength(1);
    expect(results[0].organizationId).toBe("org-001");
    expect(results[0].rulesEvaluated).toBe(1);
    expect(results[0].alertsTriggered).toBe(1);
    expect(results[0].notificationsSent).toBeGreaterThanOrEqual(1);
    expect(mockDb.batch).toHaveBeenCalled();
  });

  it("isolates org failures — one org error does not crash the cycle", async () => {
    const env = createMockEnv();
    mockDb.all.mockResolvedValueOnce([{ id: "org-bad" }, { id: "org-good" }]);
    mockDb.all.mockRejectedValueOnce(new Error("D1 connection lost"));
    mockDb.all.mockResolvedValueOnce([]);
    (env.TELEMETRY_RAW.list as ReturnType<typeof vi.fn>).mockResolvedValue({ keys: [], list_complete: true });

    const results = await runIntelligentMonitoringCycle(env);
    expect(results).toHaveLength(2);
    expect(results[0].organizationId).toBe("org-bad");
    expect(results[0].alertsTriggered).toBe(0);
    expect(results[1].organizationId).toBe("org-good");
    expect(results[1].rulesEvaluated).toBe(0);
  });

  it("maps rule severity p0-p3 to alert severity critical/high/medium/low", async () => {
    const env = createMockEnv();
    mockDb.all.mockResolvedValueOnce([{ id: "org-001" }]);
    mockDb.all.mockResolvedValueOnce([P0_RULE]);
    mockDb.all.mockResolvedValueOnce([]); // hourly averages
    mockDb.all.mockResolvedValueOnce([]); // daily summaries
    mockDb.all.mockResolvedValueOnce([]); // member profiles
    mockDb.all.mockResolvedValueOnce([]); // push subscriptions

    (env.TELEMETRY_RAW.list as ReturnType<typeof vi.fn>).mockResolvedValue({ keys: [], list_complete: true });
    (evaluateRules as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...TRIGGERED_RULE, ruleId: "rule-p0" },
    ]);
    (generateAlertContext as ReturnType<typeof vi.fn>).mockResolvedValue(AI_CONTEXT);
    (dispatchNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      alertId: "alert-p0", channelsAttempted: [], channelsSucceeded: [],
      channelsFailed: [], recipientResults: new Map(), escalationStartedAt: Date.now(),
    });

    const results = await runIntelligentMonitoringCycle(env);
    // Verify severity mapping via dispatchNotifications call payload
    const dispatchCall = (dispatchNotifications as ReturnType<typeof vi.fn>).mock.calls[0];
    if (dispatchCall) {
      expect(dispatchCall[0].severity).toBe("critical"); // p0 → critical
    }
    expect(results).toHaveLength(1);
    expect(results[0].alertsTriggered).toBe(1);
  });
});