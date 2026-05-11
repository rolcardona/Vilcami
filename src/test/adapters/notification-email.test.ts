import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationPayload, NotificationRecipient } from "../../adapters/notification-adapter.interface";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const VALID_SENDGRID_CONFIG = {
  apiKey: "SG.test-api-key-32-characters-x",
  fromEmail: "alerts@vilcami.com",
  fromName: "VILCAMI Alerts",
};

const samplePayload: NotificationPayload = {
  alertId: "alert-002",
  organizationId: "org-001",
  severity: "high",
  message: "Humidity above safe range",
  deviceId: "device-002",
  sensorType: "humidity",
  currentValue: 85.0,
  thresholdValue: 75.0,
};

const emailRecipient: NotificationRecipient = {
  memberId: "member-001",
  email: "admin@factory.com",
};

describe("EmailNotificationAdapter", () => {
  let EmailNotificationAdapter: typeof import("../../adapters/notification-email.adapter").EmailNotificationAdapter;

  beforeEach(async () => {
    mockFetch.mockReset();
    const mod = await import("../../adapters/notification-email.adapter");
    EmailNotificationAdapter = mod.EmailNotificationAdapter;
  });

  // ---------------------------------------------------------------------------
  // channel
  // ---------------------------------------------------------------------------
  it("should have channel 'email'", () => {
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    expect(adapter.channel).toBe("email");
  });

  // ---------------------------------------------------------------------------
  // validateConfig
  // ---------------------------------------------------------------------------
  it("should validate config when apiKey and fromEmail are present", () => {
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    expect(adapter.validateConfig()).toBe(true);
  });

  it("should invalidate config when apiKey is empty", () => {
    const adapter = new EmailNotificationAdapter({
      ...VALID_SENDGRID_CONFIG,
      apiKey: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  it("should invalidate config when fromEmail is empty", () => {
    const adapter = new EmailNotificationAdapter({
      ...VALID_SENDGRID_CONFIG,
      fromEmail: "",
    });
    expect(adapter.validateConfig()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — success
  // ---------------------------------------------------------------------------
  it("should send email and return true on success (202)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const result = await adapter.send(samplePayload, emailRecipient);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should call SendGrid v3 mail/send endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    await adapter.send(samplePayload, emailRecipient);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("https://api.sendgrid.com/v3/mail/send");
  });

  it("should include Bearer auth header with apiKey", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    await adapter.send(samplePayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).toHaveProperty(
      "Authorization",
      `Bearer ${VALID_SENDGRID_CONFIG.apiKey}`,
    );
  });

  // ---------------------------------------------------------------------------
  // send — HTML body with severity colors
  // ---------------------------------------------------------------------------
  it("should include severity-colored HTML in email body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    await adapter.send(samplePayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.content[0].type).toBe("text/html");
    expect(body.content[0].value).toContain("#ea580c"); // orange for high
  });

  it("should use red color for critical severity", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const criticalPayload: NotificationPayload = {
      ...samplePayload,
      severity: "critical",
    };
    await adapter.send(criticalPayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.content[0].value).toContain("#dc2626"); // red
  });

  it("should use yellow color for medium severity", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const mediumPayload: NotificationPayload = {
      ...samplePayload,
      severity: "medium",
    };
    await adapter.send(mediumPayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.content[0].value).toContain("#eab308"); // yellow
  });

  it("should use blue color for low severity", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const lowPayload: NotificationPayload = {
      ...samplePayload,
      severity: "low",
    };
    await adapter.send(lowPayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.content[0].value).toContain("#2563eb"); // blue
  });

  it("should include device and sensor details in HTML body", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    await adapter.send(samplePayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const htmlValue = JSON.parse(options.body as string).content[0].value;
    expect(htmlValue).toContain("device-002");
    expect(htmlValue).toContain("humidity");
    expect(htmlValue).toContain("85");
    expect(htmlValue).toContain("75");
  });

  it("should include severity label in email subject", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    await adapter.send(samplePayload, emailRecipient);
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(options.body as string);
    expect(body.subject).toContain("HIGH");
    expect(body.subject).toContain("humidity");
  });

  // ---------------------------------------------------------------------------
  // send — recipient validation
  // ---------------------------------------------------------------------------
  it("should return false when recipient has no email", async () => {
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const noEmailRecipient: NotificationRecipient = { memberId: "m-003" };
    const result = await adapter.send(samplePayload, noEmailRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // send — error handling
  // ---------------------------------------------------------------------------
  it("should return false when SendGrid API returns error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const result = await adapter.send(samplePayload, emailRecipient);
    expect(result).toBe(false);
  });

  it("should return false when fetch throws network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));
    const adapter = new EmailNotificationAdapter(VALID_SENDGRID_CONFIG);
    const result = await adapter.send(samplePayload, emailRecipient);
    expect(result).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // send — invalid config guard
  // ---------------------------------------------------------------------------
  it("should return false when config is invalid before sending", async () => {
    const adapter = new EmailNotificationAdapter({
      ...VALID_SENDGRID_CONFIG,
      apiKey: "",
    });
    const result = await adapter.send(samplePayload, emailRecipient);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});