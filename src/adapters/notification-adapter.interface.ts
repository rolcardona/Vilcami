/**
 * Tipos e interfaz principal para adaptadores de notificacion.
 *
 * Todos los adaptadores de notificacion (Twilio WhatsApp/SMS, SendGrid Email,
 * Web Push) deben implementar NotificationAdapter para garantizar un contrato
 * uniforme de envio, validacion de configuracion y manejo de destinatarios.
 */

// ---------------------------------------------------------------------------
// Tipos de apoyo
// ---------------------------------------------------------------------------

/** Severidad de la alerta que genera la notificacion. */
export type NotificationSeverity = "critical" | "high" | "medium" | "low";

/** Payload estandar que recibe todo adaptador de notificacion. */
export interface NotificationPayload {
  alertId: string;
  organizationId: string;
  severity: NotificationSeverity;
  message: string;
  deviceId: string;
  sensorType: string;
  currentValue: number;
  thresholdValue: number;
}

/** Suscripcion push del navegador (RFC 8030). */
export interface PushSubscription {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

/** Destinatario de notificacion con datos de contacto por canal. */
export interface NotificationRecipient {
  memberId: string;
  email?: string;
  whatsappNumber?: string;
  smsNumber?: string;
  pushSubscription?: PushSubscription;
}

// ---------------------------------------------------------------------------
// Interfaz principal
// ---------------------------------------------------------------------------

/**
 * Contrato que todo adaptador de notificacion debe implementar.
 *
 * Garantiza operaciones uniformes de envio y validacion de configuracion
 * a traves de multiples canales (WhatsApp, SMS, Email, Push).
 */
export interface NotificationAdapter {
  readonly channel: string;
  send(
    payload: NotificationPayload,
    recipient: NotificationRecipient,
  ): Promise<boolean>;
  validateConfig(): boolean;
}