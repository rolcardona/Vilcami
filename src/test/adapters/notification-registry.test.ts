import { describe, it, expect } from "vitest";
import type { NotificationAdapter } from "../../adapters/notification-adapter.interface";

const VALID_TWILIO_CONFIG = {
  accountSid: "AC" + "a".repeat(32),
  authToken: "test-auth-token-32-characters-lo",
  fromNumber: "+1234567890",
};

const VALID_SENDGRID_CONFIG = {
  apiKey: "SG.test-api-key-32-characters-x",
  fromEmail: "alerts@vilcami.com",
  fromName: "VILCAMI Alerts",
};

const VALID_VAPID_CONFIG = {
  vapidPrivateKey: "base64url-encoded-p256-private-key",
  vapidPublicKey: "base64url-encoded-p256-public-key",
  subject: "mailto:admin@vilcami.com",
};

async function getFactory() {
  const mod = await import("../../adapters/notification-registry");
  return mod.createNotificationAdapter;
}

describe("NotificationRegistry (createNotificationAdapter)", () => {
  it("should create a whatsapp adapter from 'whatsapp' channel", async () => {
    const factory = await getFactory();
    const adapter = factory("whatsapp", { twilio: VALID_TWILIO_CONFIG });
    expect(adapter.channel).toBe("whatsapp");
    expect(typeof adapter.send).toBe("function");
    expect(typeof adapter.validateConfig).toBe("function");
  });

  it("should create an sms adapter from 'sms' channel", async () => {
    const factory = await getFactory();
    const adapter = factory("sms", { twilio: VALID_TWILIO_CONFIG });
    expect(adapter.channel).toBe("sms");
    expect(typeof adapter.send).toBe("function");
  });

  it("should create an email adapter from 'email' channel", async () => {
    const factory = await getFactory();
    const adapter = factory("email", { sendgrid: VALID_SENDGRID_CONFIG });
    expect(adapter.channel).toBe("email");
    expect(typeof adapter.send).toBe("function");
  });

  it("should create a push adapter from 'push' channel", async () => {
    const factory = await getFactory();
    const adapter = factory("push", { vapid: VALID_VAPID_CONFIG });
    expect(adapter.channel).toBe("push");
    expect(typeof adapter.send).toBe("function");
  });

  it("should throw when twilio config is missing for whatsapp channel", async () => {
    const factory = await getFactory();
    expect(() => factory("whatsapp", {})).toThrow("Twilio");
  });

  it("should throw when twilio config is missing for sms channel", async () => {
    const factory = await getFactory();
    expect(() => factory("sms", {})).toThrow("Twilio");
  });

  it("should throw when sendgrid config is missing for email channel", async () => {
    const factory = await getFactory();
    expect(() => factory("email", {})).toThrow("SendGrid");
  });

  it("should throw when vapid config is missing for push channel", async () => {
    const factory = await getFactory();
    expect(() => factory("push", {})).toThrow("VAPID");
  });

  it("should return adapter implementing NotificationAdapter interface", async () => {
    const factory = await getFactory();
    const adapter: NotificationAdapter = factory("email", {
      sendgrid: VALID_SENDGRID_CONFIG,
    });
    expect(adapter.channel).toBe("email");
    expect(typeof adapter.validateConfig()).toBe("boolean");
  });
});