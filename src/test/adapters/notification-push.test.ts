import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationPayload, NotificationRecipient } from "../../adapters/notification-adapter.interface";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const VALID_VAPID_CONFIG = {
  vapidPrivateKey: "base64url-encoded-p256-private-key",
  vapidPublicKey: "base64url-encoded-p256-public-key",
  subject: "mailto:admin@vilcami.com",
};

const samplePayload: NotificationPayload = {
  alertId: "alert-003",
  organizationId: "org-001",
  severity: "medium",
  message: "Pressure fluctuation detected",
  deviceId: "device-003",
  sensorType: "pressure",
  currentValue: 1025.0,
  thresholdValue: 1030.0,
};

const pushRecipient: NotificationRecipient = {
  memberId: "member-001",
  pushSubscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    p256dhKey: "user-p256dh-key-base64url",
    authKey: "user-auth-key-base64url",
  },
};

describe("PushNotificationAdapter", () => {
  let PushNotificationAdapter: typeof import("../../adapters/notification-push.adapter").PushNotificationAdapter;

  beforeEach(async () => {
    mockFetch.mockReset();
    const mod = await import("../../adapters/notification-push.adapter");
    PushNotificationAdapter = mod.PushNotificationAdapter;
  });

  // ---------------------------------------------------------------------------
  // channel
  // ---------------------------------------------------------------------------
  it("should have channel 'push'", () => {
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    expect(adapter.channel).toBe("push");
  });

  // ---------------------------------------------------------------------------
  // validateConfig
  // ---------------------------------------------------------------------------
  it("should validate config when all fields are present", () => {
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    expect(adapter.validateConfig()).toBe(true);
  });

  it("should invalidate config when vapidPrivateKey is empty", () => {
    const adapter = new PushNotificationAdapter({
      ...VALID_VAPID_CONFIG,
      vapidPrivateKey: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  it("should invalidate config when vapidPublicKey is empty", () => {
    const adapter = new PushNotificationAdapter({
      ...VALID_VAPID_CONFIG,
      vapidPublicKey: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  it("should invalidate config when subject is empty", () => {
    const adapter = new PushNotificationAdapter({
      ...VALID_VAPID_CONFIG,
      subject: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — success
  // ---------------------------------------------------------------------------
  it("should send push notification and return true on success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    const result = await adapter.send(samplePayload, pushRecipient);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should POST to the push subscription endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    await adapter.send(samplePayload, pushRecipient);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://fcm.googleapis.com/fcm/send/abc123");
  });

  it("should include Content-Encoding header", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    await adapter.send(samplePayload, pushRecipient);
    const options = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
  });

  it("should include TTL header", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    await adapter.send(samplePayload, pushRecipient);
    const options = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    const headers = options.headers as Record<string, string>;
    expect(headers.TTL).toBe("86400");
  });

  // ---------------------------------------------------------------------------
  // send — recipient validation
  // ---------------------------------------------------------------------------
  it("should return false when recipient has no pushSubscription", async () => {
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    const noPushRecipient: NotificationRecipient = { memberId: "m-003" };
    const result = await adapter.send(samplePayload, noPushRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // send — error handling
  // ---------------------------------------------------------------------------
  it("should return false when push service returns error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 410 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    const result = await adapter.send(samplePayload, pushRecipient);
    expect(result).toBe(false);
  });

  it("should return false when fetch throws network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Push service unreachable"));
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    const result = await adapter.send(samplePayload, pushRecipient);
    expect(result).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — invalid config guard
  // ---------------------------------------------------------------------------
  it("should return false when config is invalid before sending", async () => {
    const adapter = new PushNotificationAdapter({
      ...VALID_VAPID_CONFIG,
      vapidPrivateKey: "",
    });
    const result = await adapter.send(samplePayload, pushRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // send — notification content
  // ---------------------------------------------------------------------------
  it("should include severity in notification title", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    await adapter.send(samplePayload, pushRecipient);
    const options = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    const body = options.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.title).toContain("MEDIUM");
    expect(parsed.title).toContain("pressure");
  });

  it("should include alert metadata in notification data field", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new PushNotificationAdapter(VALID_VAPID_CONFIG);
    await adapter.send(samplePayload, pushRecipient);
    const options = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    const body = JSON.parse(options.body as string);
    expect(body.data.alertId).toBe("alert-003");
    expect(body.data.deviceId).toBe("device-003");
  });
});