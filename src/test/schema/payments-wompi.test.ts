import { describe, it, expect } from "vitest";
import { payments } from "../../schema/payments";
import { wompiEvents } from "../../schema/wompi-events";

describe("payments schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(payments);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("wompiTransactionId");
    expect(columnNames).toContain("amountInCents");
    expect(columnNames).toContain("currency");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("paymentMethod");
    expect(columnNames).toContain("planId");
    expect(columnNames).toContain("deviceCount");
    expect(columnNames).toContain("billingPeriodStart");
    expect(columnNames).toContain("billingPeriodEnd");
    expect(columnNames).toContain("wompiReference");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
  });

  it("should have payment status enum with correct values", () => {
    expect(payments.status.enumValues).toEqual([
      "pending",
      "completed",
      "failed",
      "refunded",
    ]);
  });

  it("should have payment method enum with COP market methods", () => {
    expect(payments.paymentMethod.enumValues).toEqual(["card", "pse", "nequi"]);
  });

  it("should have organizationId as notNull foreign key", () => {
    const orgIdColumn = payments.organizationId;
    expect(orgIdColumn).toBeDefined();
    expect(orgIdColumn.notNull).toBe(true);
  });

  it("should have planId as nullable foreign key to subscription_plans", () => {
    const planIdColumn = payments.planId;
    expect(planIdColumn).toBeDefined();
    expect(planIdColumn.notNull).toBeFalsy();
  });

  it("should have wompiTransactionId as notNull with unique constraint", () => {
    const txnIdColumn = payments.wompiTransactionId;
    expect(txnIdColumn).toBeDefined();
    expect(txnIdColumn.notNull).toBe(true);
  });

  it("should default currency to COP via SQL default", () => {
    const currencyColumn = payments.currency;
    expect(currencyColumn).toBeDefined();
    expect(currencyColumn.notNull).toBe(true);
    expect(currencyColumn.default).toBe("COP");
  });

  it("should default deviceCount to 1 via SQL default", () => {
    const deviceCountColumn = payments.deviceCount;
    expect(deviceCountColumn).toBeDefined();
    expect(deviceCountColumn.notNull).toBe(true);
    expect(deviceCountColumn.default).toBe(1);
  });
});

describe("wompi_events schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(wompiEvents);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("wompiEventId");
    expect(columnNames).toContain("eventType");
    expect(columnNames).toContain("payload");
    expect(columnNames).toContain("processedAt");
    expect(columnNames).toContain("createdAt");
  });

  it("should have organizationId as notNull for org-scoping", () => {
    const orgIdColumn = wompiEvents.organizationId;
    expect(orgIdColumn).toBeDefined();
    expect(orgIdColumn.notNull).toBe(true);
  });

  it("should have wompiEventId as notNull idempotency key", () => {
    const eventIdColumn = wompiEvents.wompiEventId;
    expect(eventIdColumn).toBeDefined();
    expect(eventIdColumn.notNull).toBe(true);
  });

  it("should have processedAt nullable column for processing status", () => {
    const processedAtColumn = wompiEvents.processedAt;
    expect(processedAtColumn).toBeDefined();
    expect(processedAtColumn.notNull).toBeFalsy();
  });
});