/**
 * NotificationDispatcher — Servicio de despacho de notificaciones.
 *
 * Determina los canales segun severidad (P0-P3), resuelve adaptadores
 * via el registry, y envia notificaciones con degradacion graceful.
 *
 * Routing por severidad:
 *   P0 (critical) -> whatsapp + sms + push
 *   P1 (high)     -> whatsapp + push
 *   P2 (medium)   -> push + email
 *   P3 (low)       -> email
 */
import type {
  AlertSeverity,
  NotificationChannel,
  NotificationPayload,
  NotificationRecipient,
  NotificationAdapter,
} from "../adapters/notification-adapter.interface";
import { createNotificationAdapter, type NotificationAdapterConfigs } from "../adapters/notification-registry";

// ---------------------------------------------------------------------------
// DispatchResult
// ---------------------------------------------------------------------------

export interface DispatchResult {
  alertId: string;
  channelsAttempted: string[];
  channelsSucceeded: string[];
  channelsFailed: string[];
  recipientResults: Map<string, boolean>;
  escalationStartedAt: number;
}

// ---------------------------------------------------------------------------
// Severity -> Channels mapping
// ---------------------------------------------------------------------------

const SEVERITY_CHANNEL_MAP: Record<AlertSeverity, NotificationChannel[]> = {
  p0: ["whatsapp", "sms", "push"],
  p1: ["whatsapp", "push"],
  p2: ["push", "email"],
  p3: ["email"],
};

/** Devuelve los canales de notificacion correspondientes a una severidad. */
export function getChannelsForSeverity(severity: AlertSeverity): NotificationChannel[] {
  return SEVERITY_CHANNEL_MAP[severity];
}

// ---------------------------------------------------------------------------
// Core dispatch
// ---------------------------------------------------------------------------

/**
 * Despacha notificaciones a los canales determinados por severidad.
 * - Resuelve adaptadores via createNotificationAdapter.
 * - Degradacion graceful: si un canal falla o no tiene config, continua.
 * - Registra resultado por canal y por destinatario.
 */
export async function dispatchNotifications(
  alertPayload: NotificationPayload,
  _alertRule: unknown,
  recipients: NotificationRecipient[],
  adapterConfigs: NotificationAdapterConfigs,
): Promise<DispatchResult> {
  const channels = getChannelsForSeverity(alertPayload.severity);
  const escalationStartedAt = Date.now();

  const channelsAttempted: string[] = [];
  const channelsSucceeded: string[] = [];
  const channelsFailed: string[] = [];
  const recipientResults = new Map<string, boolean>();

  // Inicializar estado de cada destinatario como no exitoso
  for (const recipient of recipients) {
    recipientResults.set(recipient.memberId, false);
  }

  for (const channel of channels) {
    channelsAttempted.push(channel);

    // Resolver adaptador — si falla, marcar canal como fallido y continuar
    let adapter: NotificationAdapter;
    try {
      adapter = createNotificationAdapter(channel, adapterConfigs);
    } catch {
      channelsFailed.push(channel);
      continue;
    }

    // Verificar si el adaptador esta configurado
    if (!adapter.isConfigured()) {
      channelsFailed.push(channel);
      continue;
    }

    // Enviar a cada destinatario
    let channelHadSuccess = false;
    for (const recipient of recipients) {
      try {
        const sendResult = await adapter.send(alertPayload, recipient);
        if (sendResult.success) {
          channelHadSuccess = true;
          recipientResults.set(recipient.memberId, true);
        }
      } catch {
        // Adapter threw — log and continue
      }
    }

    if (channelHadSuccess) {
      channelsSucceeded.push(channel);
    } else {
      channelsFailed.push(channel);
    }
  }

  return {
    alertId: alertPayload.alertId,
    channelsAttempted,
    channelsSucceeded,
    channelsFailed,
    recipientResults,
    escalationStartedAt,
  };
}