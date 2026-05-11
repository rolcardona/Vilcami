/**
 * EmailNotificationAdapter — HTML emails via SendGrid v3 API.
 *
 * Severity-colored templates:
 *   critical = red (#dc2626), high = orange (#ea580c),
 *   medium = yellow (#eab308), low = blue (#2563eb).
 *
 * SendGrid API key loaded from encrypted KV Vault (see loadSendGridConfigFromVault).
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

export interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

// ---------------------------------------------------------------------------
// Severity-based styling
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<NotificationSeverity, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#eab308",
  low: "#2563eb",
};

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class EmailNotificationAdapter implements NotificationAdapter {
  readonly channel = "email";
  private readonly config: SendGridConfig;

  constructor(config: SendGridConfig) {
    this.config = config;
  }

  validateConfig(): boolean {
    return this.config.apiKey.length > 0 && this.config.fromEmail.length > 0;
  }

  async send(
    payload: NotificationPayload,
    recipient: NotificationRecipient,
  ): Promise<boolean> {
    if (!this.validateConfig()) return false;
    if (!recipient.email) return false;

    const htmlBody = this.buildHtmlBody(payload);
    const label = SEVERITY_LABELS[payload.severity];

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient.email }] }],
          from: { email: this.config.fromEmail, name: this.config.fromName },
          subject: `[${label}] Alert: ${payload.sensorType} - ${payload.deviceId}`,
          content: [{ type: "text/html", value: htmlBody }],
        }),
      });
      return response.ok || response.status === 202;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHtmlBody(payload: NotificationPayload): string {
    const color = SEVERITY_COLORS[payload.severity];
    const label = SEVERITY_LABELS[payload.severity];
    return (
      `<div style="border-left:4px solid ${color};padding:16px;font-family:sans-serif">` +
      `<h2 style="color:${color}">${label} ALERT</h2>` +
      `<p><strong>Message:</strong> ${payload.message}</p>` +
      `<p><strong>Device:</strong> ${payload.deviceId}</p>` +
      `<p><strong>Sensor:</strong> ${payload.sensorType}</p>` +
      `<p><strong>Current Value:</strong> ${payload.currentValue}</p>` +
      `<p><strong>Threshold:</strong> ${payload.thresholdValue}</p>` +
      `<p><strong>Organization:</strong> ${payload.organizationId}</p>` +
      `</div>`
    );
  }
}

// ---------------------------------------------------------------------------
// Vault loader (credentials from encrypted KV)
// ---------------------------------------------------------------------------

export async function loadSendGridConfigFromVault(
  kv: KVNamespace,
  encryptionKey: string,
): Promise<SendGridConfig> {
  const { decryptValue } = await import("../utils/kv-vault.util");

  const [encryptedApiKey, fromEmail, fromName] = await Promise.all([
    kv.get("sendgrid:api_key_encrypted"),
    kv.get("sendgrid:from_email"),
    kv.get("sendgrid:from_name"),
  ]);

  if (!encryptedApiKey || !fromEmail || !fromName) {
    throw new Error("Missing SendGrid credentials in KV Vault");
  }

  const encryptedPayload = JSON.parse(encryptedApiKey);
  const apiKey = await decryptValue(encryptedPayload, encryptionKey);

  return { apiKey, fromEmail, fromName };
}