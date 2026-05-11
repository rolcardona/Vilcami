import { describe, it, expect } from "vitest";
import * as notificationModule from "../../adapters/notification-adapter.interface";

describe("NotificationAdapter Interface", () => {
  it("should export the module from the adapters directory", () => {
    expect(notificationModule).toBeDefined();
  });

  it("should export NotificationPayload type (compile-time duck-type check)", () => {
    const payload: notificationModule.NotificationPayload = {
      alertId: "alert-001",
      organizationId: "org-001",
      severity: "critical",
      message: "Temperature exceeded threshold",
      deviceId: "device-001",
      sensorType: "temperature",
      currentValue: 45.0,
      thresholdValue: 40.0,
    };
    expect(payload.severity).toBe("critical");
    expect(payload.currentValue).toBe(45.0);
  });

  it("should export NotificationRecipient type (compile-time duck-type check)", () => {
    const recipient: notificationModule.NotificationRecipient = {
      memberId: "member-001",
      email: "admin@vilcami.com",
      whatsappNumber: "+5491112345678",
      smsNumber: "+5491112345678",
      pushSubscription: {
        endpoint: "https://push.example.com/sub/123",
        p256dhKey: "key-p256dh",
        authKey: "key-auth",
      },
    };
    expect(recipient.memberId).toBe("member-001");
    expect(recipient.pushSubscription?.endpoint).toBe(
      "https://push.example.com/sub/123",
    );
  });

  it("should allow an object literal to satisfy the NotificationAdapter shape", () => {
    const mockAdapter: notificationModule.NotificationAdapter = {
      channel: "email",
      send: async (_payload, _recipient) => true,
      validateConfig: () => true,
    };
    expect(mockAdapter.channel).toBe("email");
    expect(typeof mockAdapter.send).toBe("function");
    expect(typeof mockAdapter.validateConfig).toBe("function");
  });

  it("should support all four severity levels in NotificationSeverity", () => {
    const severities: notificationModule.NotificationSeverity[] = [
      "critical",
      "high",
      "medium",
      "low",
    ];
    expect(severities.length).toBe(4);
  });
});