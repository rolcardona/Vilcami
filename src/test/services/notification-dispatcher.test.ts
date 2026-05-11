/**
 * Tests for NotificationDispatcher service.
 * TDD — written BEFORE implementation.
 *
 * Covers:
 * - Severity routing: P0->whatsapp+sms+push, P1->whatsapp+push, P2->push+email, P3->email
 * - Adapter resolution from registry
 * - Graceful degradation on missing config
 * - Graceful handling of adapter send failures
 * - Empty channels list
 * - Escalation timer tracking
 * - DispatchResult structure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  NotificationPayload,
  NotificationRecipient,
  NotificationAdapter,
  NotificationSendResult,
  NotificationChannel,
} from "../../adapters/notification-adapter.interface";
import type { NotificationAdapterConfigs } from "../../adapters/notification-registry";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestPayload(severity: NotificationPayload["severity"]): NotificationPayload {
  return {
    alertId: "alert-001",
    alertRuleId: "rule-001",
    severity,
    message: "Temperature exceeds threshold",
    deviceId: "device-001",
    sensorId: "sensor-001",
    currentValue: 42.5,
    thresholdValue: 40.0,
    organizationId: "org-001",
    triggeredAt: Date.now(),
  };
}

function createTestRecipient(overrides?: Partial<NotificationRecipient>): NotificationRecipient {
  return {
    memberId: "member-001",
    email: "tech@org.com",
    phone: "+5491112345678",
    pushToken: "push-token-abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function createMockAdapter(
  channel: NotificationChannel,
  shouldFail = false,
  isConfigured = true,
): NotificationAdapter {
  return {
    channel,
    isConfigured: () => isConfigured,
    send: vi.fn(async (_payload: NotificationPayload, recipient: NotificationRecipient) => {
      if (shouldFail) {
        return {
          channel,
          recipientId: recipient.memberId,
          success: false,
          errorMessage: `Simulated failure on ${channel}`,
        };
      }
      return {
        channel,
        recipientId: recipient.memberId,
        success: true,
      };
    }),
  } satisfies NotificationAdapter;
}

// ---------------------------------------------------------------------------
// Import after mocks are ready
// ---------------------------------------------------------------------------

// We mock the registry to control adapter creation
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
    it("returns whatsapp+sms+push for P0 (critical)", () => {
      const channels = getChannelsForSeverity("p0");
      expect(channels).toEqual(["whatsapp", "sms", "push"]);
    });

    it("returns whatsapp+push for P1 (high)", () => {
      const channels = getChannelsForSeverity("p1");
      expect(channels).toEqual(["whatsapp", "push"]);
    });

    it("returns push+email for P2 (medium)", () => {
      const channels = getChannelsForSeverity("p2");
      expect(channels).toEqual(["push", "email"]);
    });

    it("returns email for P3 (low)", () => {
      const channels = getChannelsForSeverity("p3");
      expect(channels).toEqual(["email"]);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — severity routing
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — severity routing", () => {
    it("sends to whatsapp+sms+push when severity is P0", async () => {
      const payload = createTestPayload("p0");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromPhone: "+1", whatsappFrom: "whatsapp:+1" },
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      const whatsappAdapter = createMockAdapter("whatsapp");
      const smsAdapter = createMockAdapter("sms");
      const pushAdapter = createMockAdapter("push");

      mockCreateAdapter
        .mockReturnValueOnce(whatsappAdapter)
        .mockReturnValueOnce(smsAdapter)
        .mockReturnValueOnce(pushAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["whatsapp", "sms", "push"]);
      expect(mockCreateAdapter).toHaveBeenCalledWith("whatsapp", adapterConfigs);
      expect(mockCreateAdapter).toHaveBeenCalledWith("sms", adapterConfigs);
      expect(mockCreateAdapter).toHaveBeenCalledWith("push", adapterConfigs);
    });

    it("sends to whatsapp+push when severity is P1", async () => {
      const payload = createTestPayload("p1");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromPhone: "+1", whatsappFrom: "whatsapp:+1" },
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("whatsapp"))
        .mockReturnValueOnce(createMockAdapter("push"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["whatsapp", "push"]);
    });

    it("sends to push+email when severity is P2", async () => {
      const payload = createTestPayload("p2");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      mockCreateAdapter
        .mockReturnValueOnce(createMockAdapter("push"))
        .mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsAttempted).toEqual(["push", "email"]);
    });

    it("sends to email when severity is P3", async () => {
      const payload = createTestPayload("p3");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
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
      const payload = createTestPayload("p2");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
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
      const payload = createTestPayload("p2");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        // push config intentionally missing
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      // Registry throws for push (missing config), returns adapter for email
      mockCreateAdapter
        .mockImplementationOnce(() => { throw new Error("Missing push config for channel 'push'"); })
        .mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      // Push should be in failed, email should succeed
      expect(result.channelsFailed).toContain("push");
      expect(result.channelsSucceeded).toContain("email");
      expect(result.channelsAttempted).toContain("push");
      expect(result.channelsAttempted).toContain("email");
    });

    it("skips adapter that is not configured (isConfigured returns false)", async () => {
      const payload = createTestPayload("p3");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      const unconfiguredAdapter = createMockAdapter("email", false, false);
      mockCreateAdapter.mockReturnValueOnce(unconfiguredAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      // Adapter exists but is not configured — should be skipped and marked failed
      expect(result.channelsFailed).toContain("email");
      expect(result.channelsSucceeded).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — adapter send failures
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — adapter send failures", () => {
    it("handles adapter send failures gracefully (logs error, continues)", async () => {
      const payload = createTestPayload("p2");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      const failingPushAdapter = createMockAdapter("push", true);
      const successEmailAdapter = createMockAdapter("email", false);

      mockCreateAdapter
        .mockReturnValueOnce(failingPushAdapter)
        .mockReturnValueOnce(successEmailAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      // Push failed but email succeeded — graceful degradation
      expect(result.channelsFailed).toContain("push");
      expect(result.channelsSucceeded).toContain("email");
      // All channels were attempted
      expect(result.channelsAttempted).toEqual(["push", "email"]);
    });

    it("handles complete failure across all channels", async () => {
      const payload = createTestPayload("p3");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      const failingEmailAdapter = createMockAdapter("email", true);
      mockCreateAdapter.mockReturnValueOnce(failingEmailAdapter);

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.channelsFailed).toEqual(["email"]);
      expect(result.channelsSucceeded).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — empty channels
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — empty channels", () => {
    it("handles empty recipients list gracefully", async () => {
      const payload = createTestPayload("p3");
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [], adapterConfigs);

      // Channel was attempted but no recipients means it still counts as attempted
      expect(result.channelsAttempted).toEqual(["email"]);
      expect(result.recipientResults.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — DispatchResult structure
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — DispatchResult", () => {
    it("returns correct DispatchResult with alertId matching payload", async () => {
      const payload = createTestPayload("p1");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromPhone: "+1", whatsappFrom: "whatsapp:+1" },
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
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
      const payload = createTestPayload("p3");
      const recipientA = createTestRecipient({ memberId: "member-A", email: "a@org.com" });
      const recipientB = createTestRecipient({ memberId: "member-B", email: "b@org.com" });
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email"));

      const result = await dispatchNotifications(payload, payload, [recipientA, recipientB], adapterConfigs);

      expect(result.recipientResults.get("member-A")).toBe(true);
      expect(result.recipientResults.get("member-B")).toBe(true);
    });

    it("marks recipient as failed when all channel sends fail for them", async () => {
      const payload = createTestPayload("p3");
      const recipient = createTestRecipient({ memberId: "member-fail" });
      const adapterConfigs: NotificationAdapterConfigs = {
        email: { apiKey: "key", fromEmail: "noreply@org.com" },
      };

      mockCreateAdapter.mockReturnValueOnce(createMockAdapter("email", true));

      const result = await dispatchNotifications(payload, payload, [recipient], adapterConfigs);

      expect(result.recipientResults.get("member-fail")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // dispatchNotifications — escalation timer tracking
  // -------------------------------------------------------------------------

  describe("dispatchNotifications — escalation timer", () => {
    it("includes escalationStartedAt timestamp in result when dispatch begins", async () => {
      const payload = createTestPayload("p0");
      const recipient = createTestRecipient();
      const adapterConfigs: NotificationAdapterConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromPhone: "+1", whatsappFrom: "whatsapp:+1" },
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
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
      const payload = createTestPayload("p1");
      const recipientA = createTestRecipient({ memberId: "member-A" });
      const recipientB = createTestRecipient({ memberId: "member-B" });
      const adapterConfigs: NotificationAdapterConfigs = {
        twilio: { accountSid: "sid", authToken: "token", fromPhone: "+1", whatsappFrom: "whatsapp:+1" },
        push: { fcmApiKey: "key", vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      };

      const whatsappAdapter = createMockAdapter("whatsapp");
      const pushAdapter = createMockAdapter("push");

      mockCreateAdapter
        .mockReturnValueOnce(whatsappAdapter)
        .mockReturnValueOnce(pushAdapter);

      await dispatchNotifications(payload, payload, [recipientA, recipientB], adapterConfigs);

      // Each adapter.send should be called once per recipient
      expect(whatsappAdapter.send).toHaveBeenCalledTimes(2);
      expect(pushAdapter.send).toHaveBeenCalledTimes(2);
    });
  });
});