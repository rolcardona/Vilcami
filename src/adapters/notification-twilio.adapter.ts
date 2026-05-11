/**
 * TwilioNotificationAdapter — WhatsApp and SMS notifications via Twilio REST API.
 *
 * Supports both 'whatsapp' and 'sms' channels through a single adapter class.
 * Credentials loaded from encrypted KV Vault (see loadTwilioConfigFromVault).
 * Severity-based template prefixes in message body.
 */
import type {
  NotificationAdapter,
  NotificationPayload,
  NotificationRecipient,
  NotificationSeverity,
} from "./notification-adapter.interface";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

// ---------------------------------------------------------------------------
// Severity-based message templates
// ---------------------------------------------------------------------------

const SEVERITY_PREFIX: Record<NotificationSeverity, string> = {
  critical: "[CRITICAL ALERT]",
  high: "[HIGH ALERT]",
  medium: "[MEDIUM ALERT]",
  low: "[LOW ALERT]",
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class TwilioNotificationAdapter implements NotificationAdapter {
  readonly channel: string;
  private readonly config: TwilioConfig;

  constructor(channel: "whatsapp" | "sms", config: TwilioConfig) {
    this.channel = channel;
    this.config = config;
  }

  validateConfig(): boolean {
    return (
      this.config.accountSid.length > 0 &&
      this.config.authToken.length > 0 &&
      this.config.fromNumber.length > 0
    );
  }

  async send(
    payload: NotificationPayload,
    recipient: NotificationRecipient,
  ): Promise<boolean> {
    if (!this.validateConfig()) return false;

    const recipientNumber =
      this.channel === "whatsapp"
        ? recipient.whatsappNumber
        : recipient.smsNumber;
    if (!recipientNumber) return false;

    const prefix = this.channel === "whatsapp" ? "whatsapp:" : "";
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const formData = new URLSearchParams();
    formData.set("From", `${prefix}${this.config.fromNumber}`);
    formData.set("To", `${prefix}${recipientNumber}`);
    formData.set("Body", this.buildMessageBody(payload));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${this.config.accountSid}:${this.config.authToken}`)}`,
        },
        body: formData.toString(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildMessageBody(payload: NotificationPayload): string {
    const prefix = SEVERITY_PREFIX[payload.severity];
    return (
      `${prefix} ${payload.message} | ` +
      `Device: ${payload.deviceId} | ` +
      `${payload.sensorType}: ${payload.currentValue} (threshold: ${payload.thresholdValue})`
    );
  }
}

// ---------------------------------------------------------------------------
// Vault loader (credentials from encrypted KV)
// ---------------------------------------------------------------------------

export async function loadTwilioConfigFromVault(
  kv: KVNamespace,
  encryptionKey: string,
): Promise<TwilioConfig> {
  const { decryptValue } = await import("../utils/kv-vault.util");

  const [accountSid, encryptedAuthToken, fromNumber] = await Promise.all([
    kv.get("twilio:account_sid"),
    kv.get("twilio:auth_token_encrypted"),
    kv.get("twilio:from_number"),
  ]);

  if (!accountSid || !encryptedAuthToken || !fromNumber) {
    throw new Error("Missing Twilio credentials in KV Vault");
  }

  const encryptedPayload = JSON.parse(encryptedAuthToken);
  const authToken = await decryptValue(encryptedPayload, encryptionKey);

  return { accountSid, authToken, fromNumber };
}