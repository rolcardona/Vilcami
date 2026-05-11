/**
 * NotificationRegistry — Factory pattern for notification adapters.
 *
 * Resolves channel name ('whatsapp', 'sms', 'email', 'push') to the
 * corresponding adapter instance. Severity-based channel routing
 * (P0-P3) is handled by the dispatcher, not this registry.
 */
import type { NotificationAdapter } from "./notification-adapter.interface";
import type { TwilioConfig } from "./notification-twilio.adapter";
import type { SendGridConfig } from "./notification-email.adapter";
import type { VapidConfig } from "./notification-push.adapter";
import { TwilioNotificationAdapter } from "./notification-twilio.adapter";
import { EmailNotificationAdapter } from "./notification-email.adapter";
import { PushNotificationAdapter } from "./notification-push.adapter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannel = "whatsapp" | "sms" | "email" | "push";

export interface NotificationRegistryConfigs {
  twilio?: TwilioConfig;
  sendgrid?: SendGridConfig;
  vapid?: VapidConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createNotificationAdapter(
  channel: NotificationChannel,
  configs: NotificationRegistryConfigs,
): NotificationAdapter {
  switch (channel) {
    case "whatsapp":
    case "sms":
      if (!configs.twilio) {
        throw new Error("Twilio config required for whatsapp/sms channels");
      }
      return new TwilioNotificationAdapter(channel, configs.twilio);

    case "email":
      if (!configs.sendgrid) {
        throw new Error("SendGrid config required for email channel");
      }
      return new EmailNotificationAdapter(configs.sendgrid);

    case "push":
      if (!configs.vapid) {
        throw new Error("VAPID config required for push channel");
      }
      return new PushNotificationAdapter(configs.vapid);
  }
}