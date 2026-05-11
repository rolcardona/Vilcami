/**
 * Tests for NotificationDispatcher service.
 * TDD — written BEFORE implementation.
 *
 * Covers:
 * - Severity routing: critical->whatsapp+sms+push, high->whatsapp+push, medium->push+email, low->email
 * - Adapter resolution from registry
 * - Graceful degradation on missing config
 * - Graceful handling of adapter send failures
 * - Empty recipients
 * - DispatchResult structure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  NotificationPayload,
  NotificationRecipient,
  NotificationAdapter,
} from "../../adapters/notification-adapter.interface";
import type { NotificationChannel, NotificationRegistryConfigs } from "../../adapters/notification-registry";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestPayload(severity: NotificationPayload["severity"]): NotificationPayload {
  return {
    alertId: "alert-001",
    organizationId: "org-001",
    severity,
    message: "Temperature exceeds threshold",
    deviceId: "device-001",
    sensorType: "temperature",
    currentValue: 42.5,
    thresholdValue: 40.0,
  };
}

function createTestRecipient(overrides?: Partial<NotificationRecipient>): NotificationRecipient {
  return {
    memberId: "member-001",
    email: "tech@org.com",
    whatsappNumber: "+5491112345678",
    pushSubscription: { endpoint: "https://push.example.com/abc", p256dhKey: "key", authKey: "auth" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(
  channel: NotificationChannel,
  shouldFail = false,
  isValid = true,
): NotificationAdapter {
  return {
    channel,
    validateConfig: () => isValid,
    send: vi.fn(async () => {
      if (shouldFail) throw new Error(`Simulated failure on ${channel}`);
      return true;
    }),
  };
}

// ---------------------------------------------------------------------------
// Import after mocks are ready
// ---------------------------------------------------------------------------

vi.mock("../../adapters/notification-registry", () => ({
  createNotificationAdapter: vi.fn(),
}));

import { createNotificationAdapter } from "../../adapters/notification-registry";
import {
  dispatchNotifications,
  getChannelsForSeverity,
  type DispatchResult,
} from "../../services/notification-dispatcher.service";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotificationDispatcher", () => {
  const mockCreateAdapter = vi.mocked(createNotificationAdapter);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getChannelsForSeverity
  // -------------------------------------------------------------------------

  describe("getChannelsForSeverity", () => {
    it("returns whatsapp+sms+push for critical", () => {
      const channels = getChannelsForSeverity("critical");
      expect(channels).toEqual(["whatsapp", "sms", "push"]);
    });

    it("returns whatsapp+push for high", () => {
      const channels = getChannelsForSeverity("high");
      expect(channels).toEqual(["whatsapp", "push"]);
    });

    it("returns push+email for medium", () => {
      const channels = getChannelsForSeverity("medium");
      expect(channels).toEqual(["push", "email"]);
    });

    it("returns email for low", () => {
      const channels = getChannelsForSeverity("low");
      expect(channels).toEqual(["email"]);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — severity routing
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — severity routing", () => {
    it("sends to whatsapp+sms+push when severity is critical", async () => {
      const payload = createTestPayload("critical");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromNumber: "+15551234567" },
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("whatsapp"))
        .mockReturnValueOnce(createMockAdapter("sms"))
        .mockReturnValueOnce(createMockAdapter("push"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["whatsapp", "sms", "push"]);
      expect(mockCreateAdapter).toHaveBeenCalledWith("whatsapp", adapterConfigs);
      expect(mockCreateAdapter).toHaveBeenCalledWith("sms", adapterConfigs);
      expect(mockCreateAdapter).toHaveBeenCalledWith("push", adapterConfigs);
    });

    it("sends to whatsapp+push when severity is high", async () => {
      const payload = createTestPayload("high");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromNumber: "+15551234567" },
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("whatsapp"))
        .mockReturnValueOnce(createMockAdapter("push"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["whatsapp", "push"]);
    });

    it("sends to push+email when severity is medium", async () => {
      const payload = createTestPayload("medium");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("push"))
        .mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["push", "email"]);
    });

    it("sends to email when severity is low", async () => {
      const payload = createTestPayload("low");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["email"]);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — adapter resolution
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — adapter resolution", () => {
    it("resolves adapters from registry for each channel", async () => {
      const payload = createTestPayload("medium");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("push"))
        .mockReturnValueOnce(createMockAdapter("email"));

      await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(mockCreateAdapter).toHaveBeenCalledTimes(2);
      expect(mockCreateAdapter).toHaveBeenCalledWith("push", adapterConfigs);
      expect(mockCreateAdapter).toHaveBeenCalledWith("email", adapterConfigs);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — graceful degradation
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — graceful degradation", () => {
    it("skips channels with missing config (registry throws)", async () => {
      const payload = createTestPayload("medium");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter
        .mockImplementationOnce(() => { throw new Error("Missing push config"); })
        .mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsFailed).toContain("push");
      expect(result.channelsSucceeded).toContain("email");
      expect(result.channelsAttempted).toContain("push");
      expect(result.channelsAttempted).toContain("email");
    });

    it("skips adapter that is not configured (validateConfig returns false)", async () => {
      const payload = createTestPayload("low");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      const unconfiguredAdapter = createMockAdapter("email", false, false);
      mockCreateAdapter.mockReturnValueOnce(unconfiguredAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsFailed).toContain("email");
      expect(result.channelsSucceeded).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — adapter send failures
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — adapter send failures", () => {
    it("handles adapter send failures gracefully", async () => {
      const payload = createTestPayload("medium");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      const failingPushAdapter = createMockAdapter("push", true);
      const successEmailAdapter = createMockAdapter("email", false);

      mockCreateAdapter
        .mockReturnValueOnce(failingPushAdapter)
        .mockReturnValueOnce(successEmailAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsFailed).toContain("push");
      expect(result.channelsSucceeded).toContain("email");
      expect(result.channelsAttempted).toEqual(["push", "email"]);
    });

    it("handles complete failure across all channels", async () => {
      const payload = createTestPayload("low");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      const failingEmailAdapter = createMockAdapter("email", true);
      mockCreateAdapter.mockReturnValueOnce(failingEmailAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsFailed).toEqual(["email"]);
      expect(result.channelsSucceeded).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — empty recipients
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — empty recipients", () => {
    it("handles empty recipients list gracefully", async () => {
      const payload = createTestPayload("low");
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["email"]);
      expect(result.recipientResults.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — DispatchResult structure
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — DispatchResult", () => {
    it("returns correct DispatchResult with alertId matching payload", async () => {
      const payload = createTestPayload("high");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromNumber: "+15551234567" },
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("whatsapp"))
        .mockReturnValueOnce(createMockAdapter("push"));

      const result: DispatchResult = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.alertId).toBe("alert-001");
      expect(result.channelsAttempted).toEqual(["whatsapp", "push"]);
      expect(result.channelsSucceeded).toEqual(["whatsapp", "push"]);
      expect(result.channelsFailed).toEqual([]);
    });

    it("tracks per-recipient delivery results", async () => {
      const payload = createTestPayload("low");
      const recipientA = createTestRecipient({ memberId: "member-A", email: "a@org.com" });
      const recipientB = createTestRecipient({ memberId: "member-B", email: "b@org.com" });
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipientA, recipientB], adapterConfigs);

      expect(result.recipientResults.get("member-A")).toBe(true);
      expect(result.recipientResults.get("member-B")).toBe(true);
    });

    it("marks recipient as failed when all channel sends fail for them", async () => {
      const payload = createTestPayload("low");
      const recipient = createTestRecipient({ memberId: "member-fail" });
      const adapterConfigs: NotificationRegistryConfigs = {
        sendgrid: { apiKey: "key", fromEmail: "noreply@org.com", fromName: "Alerts" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email", true));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.recipientResults.get("member-fail")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — escalation timer
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — escalation timer", () => {
    it("includes escalationStartedAt timestamp in result", async () => {
      const payload = createTestPayload("critical");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationRegistryConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromNumber: "+15551234567" },
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("whatsapp"))
        .mockReturnValueOnce(createMockAdapter("sms"))
        .mockReturnValueOnce(createMockAdapter("push"));

      const beforeDispatch = Date.now();
      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);
      const afterDispatch = Date.now();

      expect(result.escalationStartedAt).toBeGreaterThanOrEqual(beforeDispatch);
      expect(result.escalationStartedAt).toBeLessThanOrEqual(afterDispatch);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — multiple recipients
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — multiple recipients", () => {
    it("sends notifications to all recipients across all channels", async () => {
      const payload = createTestPayload("high");
      const recipientA = createTestRecipient({ memberId: "member-A" });
      const recipientB = createTestRecipient({ memberId: "member-B" });
      const adapterConfigs: NotificationRegistryConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromNumber: "+15551234567" },
        vapid: { subject: "mailto:test@test.com", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      const whatsappAdapter = createMockAdapter("whatsapp");
      const pushAdapter = createMockAdapter("push");

      mockCreateAdapter
        .mockReturnValueOnce(whatsappAdapter)
        .mockReturnValueOnce(pushAdapter);

      await dispatchNotifications(payload, payload, [recipientA, recipientB], adapterConfigs);

      expect(whatsappAdapter.send).toHaveBeenCalledTimes(2);
      expect(pushAdapter.send).toHaveBeenCalledTimes(2);
    });
  });
});