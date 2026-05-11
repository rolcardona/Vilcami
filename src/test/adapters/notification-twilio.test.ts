import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationPayload, NotificationRecipient } from "../../adapters/notification-adapter.interface";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const VALID_TWILIO_CONFIG = {
  accountSid: "AC" + "a".repeat(32),
  authToken: "test-auth-token-32-characters-lo",
  fromNumber: "+1234567890",
};

const samplePayload: NotificationPayload = {
  alertId: "alert-001",
  organizationId: "org-001",
  severity: "critical",
  message: "Temperature exceeded threshold",
  deviceId: "device-001",
  sensorType: "temperature",
  currentValue: 45.0,
  thresholdValue: 40.0,
};

const whatsappRecipient: NotificationRecipient = {
  memberId: "member-001",
  whatsappNumber: "+5491112345678",
};

const smsRecipient: NotificationRecipient = {
  memberId: "member-002",
  smsNumber: "+5491112345678",
};

describe("TwilioNotificationAdapter", () => {
  let TwilioNotificationAdapter: typeof import("../../adapters/notification-twilio.adapter").TwilioNotificationAdapter;

  beforeEach(async () => {
    mockFetch.mockReset();
    const mod = await import("../../adapters/notification-twilio.adapter");
    TwilioNotificationAdapter = mod.TwilioNotificationAdapter;
  });

  // ---------------------------------------------------------------------------
  // channel
  // ---------------------------------------------------------------------------
  it("should have channel 'whatsapp' when created with whatsapp mode", () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    expect(adapter.channel).toBe("whatsapp");
  });

  it("should have channel 'sms' when created with sms mode", () => {
    const adapter = new TwilioNotificationAdapter("sms", VALID_TWILIO_CONFIG);
    expect(adapter.channel).toBe("sms");
  });

  // ---------------------------------------------------------------------------
  // validateConfig
  // ---------------------------------------------------------------------------
  it("should validate config when all fields are present", () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    expect(adapter.validateConfig()).toBe(true);
  });

  it("should invalidate config when accountSid is empty", () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", {
      ...VALID_TWILIO_CONFIG,
      accountSid: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  it("should invalidate config when authToken is empty", () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", {
      ...VALID_TWILIO_CONFIG,
      authToken: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  it("should invalidate config when fromNumber is empty", () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", {
      ...VALID_TWILIO_CONFIG,
      fromNumber: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — WhatsApp
  // ---------------------------------------------------------------------------
  it("should send WhatsApp notification and return true on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ sid: "SM123" }),
    });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    const result = await adapter.send(samplePayload, whatsappRecipient);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should call Twilio REST API with correct URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, whatsappRecipient);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      `Accounts/${VALID_TWILIO_CONFIG.accountSid}/Messages.json`,
    );
  });

  it("should include Basic auth header with accountSid:authToken", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, whatsappRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const expected = btoa(
      `${VALID_TWILIO_CONFIG.accountSid}:${VALID_TWILIO_CONFIG.authToken}`,
    );
    expect(options.headers).toHaveProperty(
      "Authorization",
      `Basic ${expected}`,
    );
  });

  it("should prefix From and To with 'whatsapp:' for whatsapp channel", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, whatsappRecipient);
    const body = decodeFormDataBody(mockFetch.mock.calls[0][1].body as string);
    expect(body).toContain("whatsapp:");
  });

  // ---------------------------------------------------------------------------
  // send — SMS
  // ---------------------------------------------------------------------------
  it("should send SMS notification and return true on success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("sms", VALID_TWILIO_CONFIG);
    const result = await adapter.send(samplePayload, smsRecipient);
    expect(result).toBe(true);
  });

  it("should NOT prefix From/To with 'whatsapp:' for sms channel", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("sms", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, smsRecipient);
    const body = mockFetch.mock.calls[0][1].body as string;
    expect(body).not.toContain("whatsapp%3A");
  });

  // ---------------------------------------------------------------------------
  // send — recipient validation
  // ---------------------------------------------------------------------------
  it("should return false when recipient has no whatsapp number for whatsapp channel", async () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    const noWhatsappRecipient: NotificationRecipient = { memberId: "m-003" };
    const result = await adapter.send(samplePayload, noWhatsappRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return false when recipient has no sms number for sms channel", async () => {
    const adapter = new TwilioNotificationAdapter("sms", VALID_TWILIO_CONFIG);
    const noSmsRecipient: NotificationRecipient = { memberId: "m-003" };
    const result = await adapter.send(samplePayload, noSmsRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // send — error handling
  // ---------------------------------------------------------------------------
  it("should return false when Twilio API returns error status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "Bad request" }),
    });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    const result = await adapter.send(samplePayload, whatsappRecipient);
    expect(result).toBe(false);
  });

  it("should return false when fetch throws network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    const result = await adapter.send(samplePayload, whatsappRecipient);
    expect(result).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — severity-based template
  // ---------------------------------------------------------------------------
  function decodeFormDataBody(raw: string): string {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  }

  it("should include severity prefix in message body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, whatsappRecipient);
    const body = decodeFormDataBody(mockFetch.mock.calls[0][1].body as string);
    expect(body).toContain("[CRITICAL ALERT]");
  });

  it("should include HIGH prefix for high severity", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    const highPayload: NotificationPayload = { ...samplePayload, severity: "high" };
    await adapter.send(highPayload, whatsappRecipient);
    const body = decodeFormDataBody(mockFetch.mock.calls[0][1].body as string);
    expect(body).toContain("[HIGH ALERT]");
  });

  it("should include device and sensor info in message body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
    const adapter = new TwilioNotificationAdapter("whatsapp", VALID_TWILIO_CONFIG);
    await adapter.send(samplePayload, whatsappRecipient);
    const body = decodeFormDataBody(mockFetch.mock.calls[0][1].body as string);
    expect(body).toContain("device-001");
    expect(body).toContain("temperature");
    expect(body).toContain("45");
  });

  // ---------------------------------------------------------------------------
  // send — invalid config guard
  // ---------------------------------------------------------------------------
  it("should return false when config is invalid before sending", async () => {
    const adapter = new TwilioNotificationAdapter("whatsapp", {
      ...VALID_TWILIO_CONFIG,
      authToken: "",
    });
    const result = await adapter.send(samplePayload, whatsappRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});