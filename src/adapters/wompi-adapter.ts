/**
 * Wompi Adapter — Phase 5 payment gateway integration.
 * Sandbox-first: NEVER advance to production without explicit user confirmation.
 *
 * Handles: payment link creation, webhook HMAC-SHA256 signature verification,
 * and webhook event processing with idempotency.
 */
import type { Env } from "../types/env";
import type {
  WompiPaymentLinkRequest,
  WompiPaymentLinkResponse,
  WompiWebhookPayload,
} from "../types/wompi";
import type { SubscriptionStatus } from "../types/billing.types";
import { getDrizzleDb } from "../utils/db.util";
import { payments, wompiEvents, deviceSubscriptions } from "../schema/index";
import { eq, sql } from "drizzle-orm";
import { activateSubscription } from "../services/subscription.service";

// ---------------------------------------------------------------------------
// createPaymentLink — generates a Wompi checkout URL for the given plan
// ---------------------------------------------------------------------------
export async function createPaymentLink(
  env: Env,
  request: WompiPaymentLinkRequest,
): Promise<WompiPaymentLinkResponse> {
  const baseUrl = env.WOMPI_BASE_URL;
  const response = await fetch(`${baseUrl}/payment_links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Wompi payment link creation failed: ${response.status} — ${errorBody}`);
  }

  const data = (await response.json()) as { data: WompiPaymentLinkResponse };
  return data.data;
}

// ---------------------------------------------------------------------------
// verifyWebhookSignature — HMAC-SHA256 verification of Wompi webhook
// ---------------------------------------------------------------------------
export async function verifyWebhookSignature(
  eventIntegrityKey: string,
  payload: string,
  timestamp: string,
  transactionHash: string,
): Promise<boolean> {
  const message = `${payload}${timestamp}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(eventIntegrityKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  const computedHash = bufferToHex(signature);
  return timingSafeEqual(computedHash, transactionHash);
}

// ---------------------------------------------------------------------------
// handleWebhookEvent — processes a verified Wompi webhook payload
// ---------------------------------------------------------------------------
export async function handleWebhookEvent(
  env: Env,
  organizationId: string,
  payload: WompiWebhookPayload,
): Promise<{ processed: boolean }> {
  const db = getDrizzleDb(env);
  const transactionId = payload.data.transaction.id;
  const eventType = payload.event;
  const wompiEventId = `${eventType}:${transactionId}`;

  // Idempotency check — skip if event already processed
  const existingEvent = await db.select({ id: wompiEvents.id })
    .from(wompiEvents)
    .where(eq(wompiEvents.wompiEventId, wompiEventId))
    .limit(1).get();

  if (existingEvent) {
    return { processed: true };
  }

  // Store event for idempotency
  await db.insert(wompiEvents).values({
    id: crypto.randomUUID(),
    organizationId,
    wompiEventId,
    eventType,
    payload: JSON.stringify(payload),
    processedAt: Math.floor(Date.now() / 1000),
  }).run();

  const transaction = payload.data.transaction;

  if (eventType === "transaction.approved") {
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      organizationId,
      wompiTransactionId: transactionId,
      amountInCents: transaction.amountInCents,
      currency: transaction.currency,
      status: "completed",
      paymentMethod: mapPaymentMethod(transaction.paymentMethod),
      wompiReference: transaction.reference,
      deviceCount: 1,
      billingPeriodStart: Math.floor(Date.now() / 1000),
      billingPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }).run();

    await activateSubscription(db, organizationId, "", transactionId);
  }

  if (eventType === "transaction.declined") {
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      organizationId,
      wompiTransactionId: transactionId,
      amountInCents: transaction.amountInCents,
      currency: transaction.currency,
      status: "failed",
      paymentMethod: mapPaymentMethod(transaction.paymentMethod),
      wompiReference: transaction.reference,
      deviceCount: 1,
      billingPeriodStart: Math.floor(Date.now() / 1000),
      billingPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }).run();
  }

  return { processed: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function mapPaymentMethod(method: string): "card" | "pse" | "nequi" | null {
  if (method === "card") return "card";
  if (method === "pse") return "pse";
  if (method === "nequi") return "nequi";
  return null;
}