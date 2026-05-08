import { describe, it, expect } from "vitest";
import { subscriptionPlans, subscriptionPlanNameEnum } from "../../schema/subscription-plans";
import { deviceSubscriptions, deviceSubscriptionStatusEnum } from "../../schema/device-subscriptions";
import { billingEvents, billingEventTypeEnum } from "../../schema/billing-events";

describe("subscription_plans schema", () => {
  it("should have price in cents and trial columns", () => {
    const columnNames = Object.keys(subscriptionPlans);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("pricePerDeviceCents");
    expect(columnNames).toContain("eventsIncluded");
    expect(columnNames).toContain("overagePricePerHundredCents");
    expect(columnNames).toContain("features");
    expect(columnNames).toContain("trialDays");
    expect(columnNames).toContain("maxTrialDevices");
  });

  it("should have plan name enum with Starter, Professional, Enterprise", () => {
    expect(subscriptionPlanNameEnum.config.enumValues).toEqual(["Starter", "Professional", "Enterprise"]);
  });
});

describe("device_subscriptions schema", () => {
  it("should have status enum and add_ons", () => {
    const columnNames = Object.keys(deviceSubscriptions);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("addOns");
  });

  it("should have status enum values", () => {
    expect(deviceSubscriptionStatusEnum.config.enumValues).toEqual(["trial", "active", "past_due", "suspended", "cancelled"]);
  });
});

describe("billing_events schema", () => {
  it("should have event_type and sensor_count columns", () => {
    const columnNames = Object.keys(billingEvents);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("eventType");
    expect(columnNames).toContain("sensorCount");
  });

  it("should have event type enum", () => {
    expect(billingEventTypeEnum.config.enumValues).toEqual(["api_call_tuya", "api_call_modbus"]);
  });
});