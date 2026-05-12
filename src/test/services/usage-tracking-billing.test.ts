import { describe, it, expect, beforeEach } from "vitest";
import { recordBillingEvent, checkAndRecordUsage } from "../../services/usage-tracking.service";
import { createMockKV, createMockDb, makeHourBucket, ORG_ID, DEVICE_ID, SUB_ID } from "./usage-tracking.helpers";

// ---------------------------------------------------------------------------
// recordBillingEvent — D1 analytics recording
// ---------------------------------------------------------------------------
describe("recordBillingEvent", () => {
  it("records an accepted billing event in D1", async () => {
    const mockDb = createMockDb();

    await recordBillingEvent(
      mockDb as unknown as Parameters<typeof recordBillingEvent>[0],
      ORG_ID,
      DEVICE_ID,
      "api_call_tuya",
    );

    expect(mockDb.insertedRows).toHaveLength(1);
    const event = mockDb.insertedRows[0];
    expect(event.organizationId).toBe(ORG_ID);
    expect(event.deviceExternalId).toBe(DEVICE_ID);
    expect(event.eventType).toBe("api_call_tuya");
    expect(event.id).toBeDefined();
  });

  it("records a billing event with deviceSubscriptionId when provided", async () => {
    const mockDb = createMockDb();

    await recordBillingEvent(
      mockDb as unknown as Parameters<typeof recordBillingEvent>[0],
      ORG_ID,
      DEVICE_ID,
      "api_call_tuya",
      { deviceSubscriptionId: SUB_ID },
    );

    expect(mockDb.insertedRows).toHaveLength(1);
    const event = mockDb.insertedRows[0];
    expect(event.deviceSubscriptionId).toBe(SUB_ID);
  });

  it("sets deviceSubscriptionId to null when not provided (no fabricated FK)", async () => {
    const mockDb = createMockDb();

    await recordBillingEvent(
      mockDb as unknown as Parameters<typeof recordBillingEvent>[0],
      ORG_ID,
      DEVICE_ID,
      "api_call_tuya",
    );

    expect(mockDb.insertedRows).toHaveLength(1);
    const event = mockDb.insertedRows[0];
    expect(event.deviceSubscriptionId).toBeNull();
  });

  it("records a rejected billing event with rejection reason metadata", async () => {
    const mockDb = createMockDb();

    await recordBillingEvent(
      mockDb as unknown as Parameters<typeof recordBillingEvent>[0],
      ORG_ID,
      DEVICE_ID,
      "api_call_modbus",
      { rejectionReason: "quota_exceeded" },
    );

    expect(mockDb.insertedRows).toHaveLength(1);
    const event = mockDb.insertedRows[0];
    expect(event.eventType).toBe("api_call_modbus");
    expect(event.sensorCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkAndRecordUsage — orchestrator combining throttle + event recording
// ---------------------------------------------------------------------------
describe("checkAndRecordUsage", () => {
  let kv: ReturnType<typeof createMockKV>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    kv = createMockKV();
    mockDb = createMockDb();
  });

  it("allows and records an accepted reading", async () => {
    const result = await checkAndRecordUsage(
      kv,
      mockDb as unknown as Parameters<typeof checkAndRecordUsage>[1],
      ORG_ID,
      DEVICE_ID,
      "starter",
      "api_call_tuya",
    );

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);
    expect(result.maxAllowed).toBe(60);
    expect(mockDb.insertedRows).toHaveLength(1);
    expect(mockDb.insertedRows[0].eventType).toBe("api_call_tuya");
  });

  it("passes deviceSubscriptionId through to billing event when provided", async () => {
    const result = await checkAndRecordUsage(
      kv,
      mockDb as unknown as Parameters<typeof checkAndRecordUsage>[1],
      ORG_ID,
      DEVICE_ID,
      "starter",
      "api_call_tuya",
      SUB_ID,
    );

    expect(result.allowed).toBe(true);
    expect(mockDb.insertedRows).toHaveLength(1);
    expect(mockDb.insertedRows[0].deviceSubscriptionId).toBe(SUB_ID);
  });

  it("rejects and records a rejected reading with quota_exceeded reason", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    const result = await checkAndRecordUsage(
      kv,
      mockDb as unknown as Parameters<typeof checkAndRecordUsage>[1],
      ORG_ID,
      DEVICE_ID,
      "trial",
      "api_call_modbus",
    );

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(1);
    expect(mockDb.insertedRows).toHaveLength(1);
    expect(mockDb.insertedRows[0].eventType).toBe("api_call_modbus");
  });

  it("allows enterprise plan readings (Infinity limit)", async () => {
    const result = await checkAndRecordUsage(
      kv,
      mockDb as unknown as Parameters<typeof checkAndRecordUsage>[1],
      ORG_ID,
      DEVICE_ID,
      "enterprise",
      "api_call_tuya",
    );

    expect(result.allowed).toBe(true);
    expect(result.maxAllowed).toBe(Infinity);
  });

  it("increments counter only when allowed, not when rejected", async () => {
    const key = `throttle:${ORG_ID}:${DEVICE_ID}:${makeHourBucket(new Date())}`;
    await kv.put(key, JSON.stringify({ count: 1, maxAllowed: 1 }), { expirationTtl: 3600 });

    await checkAndRecordUsage(
      kv,
      mockDb as unknown as Parameters<typeof checkAndRecordUsage>[1],
      ORG_ID,
      DEVICE_ID,
      "trial",
      "api_call_tuya",
    );

    const raw = kv.store.get(key)!;
    const parsed = JSON.parse(raw.value);
    expect(parsed.count).toBe(1);
  });
});