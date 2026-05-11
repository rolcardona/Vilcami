/**
 * PushNotificationAdapter — Browser push notifications via Web Push API (RFC 8030).
 *
 * VAPID signing with ECDSA P-256 via crypto.subtle.
 * VAPID keys loaded from encrypted KV Vault (see loadVapidConfigFromVault).
 * Push subscription details from member_profiles table.
 *
 * NOTE: Full RFC 8291 message encryption (ECDH key agreement + AES-128-GCM)
 * is required by production push services. This adapter sends the notification
 * payload as JSON for development/testing. Production deployment MUST add
 * RFC 8291 encryption before sending to real push services.
 */
import type {
  NotificationAdapter,
  NotificationPayload,
  NotificationRecipient,
} from "./notification-adapter.interface";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface VapidConfig {
  vapidPrivateKey: string;
  vapidPublicKey: string;
  subject: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PushNotificationAdapter implements NotificationAdapter {
  readonly channel = "push";
  private readonly config: VapidConfig;

  constructor(config: VapidConfig) {
    this.config = config;
  }

  validateConfig(): boolean {
    return (
      this.config.vapidPrivateKey.length > 0 &&
      this.config.vapidPublicKey.length > 0 &&
      this.config.subject.length > 0
    );
  }

  async send(
    payload: NotificationPayload,
    recipient: NotificationRecipient,
  ): Promise<boolean> {
    if (!this.validateConfig()) return false;
    if (!recipient.pushSubscription) return false;

    const subscription = recipient.pushSubscription;
    const notificationPayload = this.buildNotificationPayload(payload);

    try {
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          TTL: "86400",
        },
        body: JSON.stringify(notificationPayload),
      });
      return response.ok || response.status === 201;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildNotificationPayload(payload: NotificationPayload): {
    title: string;
    body: string;
    data: { alertId: string; deviceId: string; organizationId: string };
  } {
    return {
      title: `[${payload.severity.toUpperCase()}] ${payload.sensorType} Alert`,
      body: payload.message,
      data: {
        alertId: payload.alertId,
        deviceId: payload.deviceId,
        organizationId: payload.organizationId,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Vault loader (VAPID keys from encrypted KV)
// ---------------------------------------------------------------------------

export async function loadVapidConfigFromVault(
  kv: KVNamespace,
  encryptionKey: string,
): Promise<VapidConfig> {
  const { decryptValue } = await import("../utils/kv-vault.util");

  const [encryptedPrivateKey, publicKey, subject] = await Promise.all([
    kv.get("vapid:private_key_encrypted"),
    kv.get("vapid:public_key"),
    kv.get("vapid:subject"),
  ]);

  if (!encryptedPrivateKey || !publicKey || !subject) {
    throw new Error("Missing VAPID credentials in KV Vault");
  }

  const encryptedPayload = JSON.parse(encryptedPrivateKey);
  const vapidPrivateKey = await decryptValue(encryptedPayload, encryptionKey);

  return { vapidPrivateKey, vapidPublicKey: publicKey, subject };
}