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
import { getDrizzleDb } from "../utils/db.util";
import { payments, wompiEvents } from "../schema/index";
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
// Verifies amount against checkout record stored in KV before processing.
// Uses atomic INSERT-first idempotency to prevent TOCTOU race conditions.
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
  const transaction = payload.data.transaction;

  // Atomic idempotency: INSERT first, catch unique constraint violation.
  // This eliminates the TOCTOU race between SELECT and INSERT.
  try {
    await db.insert(wompiEvents).values({
      id: crypto.randomUUID(),
      organizationId,
      wompiEventId,
      eventType,
      payload: JSON.stringify(payload),
      processedAt: Math.floor(Date.now() / 1000),
    }).run();
  } catch (insertError: unknown) {
    if (isUniqueConstraintViolation(insertError)) {
      // Another concurrent request already inserted this event — idempotent return
      return { processed: true };
    }
    throw insertError;
  }

  // Verify amount against checkout record stored in KV
  const reference = transaction.reference;
  const checkoutDataRaw = await env.SECRETS_VAULT.get(`checkout:${reference}`);
  if (!checkoutDataRaw) {
    throw new Error(`No checkout record found for reference: ${reference}. Possible tampering or expired checkout.`);
  }

  let checkoutData: { amountInCents: number; planId: string; orgId: string };
  try {
    checkoutData = JSON.parse(checkoutDataRaw);
  } catch {
    throw new Error(`Invalid checkout data for reference: ${reference}`);
  }

  // Cross-verify amount from Wompi payload against stored checkout amount
  if (transaction.amountInCents !== checkoutData.amountInCents) {
    throw new Error(
      `Amount mismatch: Wompi reports ${transaction.amountInCents} cents but checkout was ${checkoutData.amountInCents} cents. Possible price manipulation.`,
    );
  }

  // Verify organizationId matches
  if (organizationId !== checkoutData.orgId) {
    throw new Error(
      `Organization mismatch: reference belongs to ${checkoutData.orgId} but webhook targets ${organizationId}.`,
    );
  }

  // Parse planId from reference (format: "{orgId}:{planId}:{timestamp}")
  const referenceParts = reference.split(":");
  const planId = referenceParts.length >= 2 ? referenceParts[1] : checkoutData.planId;

  // Remove checkout record from KV after verification (one-time use)
  await env.SECRETS_VAULT.delete(`checkout:${reference}`);

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
      planId,
      deviceCount: 1,
      billingPeriodStart: Math.floor(Date.now() / 1000),
      billingPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }).run();

    await activateSubscription(db, organizationId, planId, transactionId);
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
      planId,
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

/** Detects SQLite/D1 unique constraint violation (code 2067 or message pattern) */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("2067") || msg.includes("unique constraint failed") || msg.includes("unique constraint violation");
}