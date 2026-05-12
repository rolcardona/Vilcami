/**
 * Webhook Routes — Phase 5 Wompi payment event receiver.
 * NO auth middleware — security comes from HMAC-SHA256 signature verification.
 * The organizationId is extracted from the Wompi payload data, not from JWT.
 */
import { Hono } from "hono";
import type { Env } from "../types/env";
import type { WompiWebhookPayload } from "../types/wompi";
import { verifyWebhookSignature, handleWebhookEvent } from "../adapters/wompi-adapter";

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /wompi — Receive Wompi payment events (NO auth — HMAC only)
// ---------------------------------------------------------------------------
webhookRoutes.post("/wompi", async (c) => {
  // 1. Extract required headers for HMAC verification
  const transactionHash = c.req.header("x-transaction-hash");
  const timestamp = c.req.header("timestamp");

  if (!transactionHash) {
    return c.json({ error: "Missing x-transaction-hash header" }, 400);
  }
  if (!timestamp) {
    return c.json({ error: "Missing timestamp header" }, 400);
  }

  // 2. Read raw body as text for signature verification
  const rawBody = await c.req.text();

  // 3. Parse body as JSON for event processing
  let payload: WompiWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WompiWebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // 4. Verify HMAC-SHA256 signature
  const isValid = await verifyWebhookSignature(
    c.env.WOMPI_EVENT_INTEGRITY_KEY,
    rawBody,
    timestamp,
    transactionHash,
  );

  if (!isValid) {
    return c.json({ error: "invalid_signature" }, 400);
  }

  // 5. Extract organizationId from Wompi payload data
  // The reference field contains "{orgId}:{planId}:{timestamp}" format
  const reference = payload.data.transaction.reference;
  const organizationId = extractOrganizationIdFromReference(reference);

  if (!organizationId) {
    return c.json({ error: "Cannot determine organization from payload" }, 400);
  }

  // 6. Process the webhook event (idempotent)
  try {
    const result = await handleWebhookEvent(c.env, organizationId, payload);
    return c.json({ processed: result.processed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    return c.json({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helper: extract organizationId from Wompi transaction reference
// ---------------------------------------------------------------------------
function extractOrganizationIdFromReference(reference: string): string | null {
  // Reference format: "{orgId}:{planId}:{timestamp}"
  const parts = reference.split(":");
  if (parts.length >= 1 && parts[0].length > 0) {
    return parts[0];
  }
  return null;
}