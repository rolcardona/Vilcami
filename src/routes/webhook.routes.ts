/**
 * Webhook Routes — Phase 5 Wompi payment event receiver.
 * NO auth middleware — security comes from HMAC-SHA256 signature verification.
 * The organizationId is extracted from the Wompi payload data, not from JWT.
 * Rate limiting: per-IP throttle via THROTTLE_KV (60 req/min/IP).
 */
import { Hono } from "hono";
import type { Env } from "../types/env";
import type { WompiWebhookPayload } from "../types/wompi";
import { verifyWebhookSignature, handleWebhookEvent } from "../adapters/wompi-adapter";

/** Maximum age for webhook timestamps — 5 minutes to prevent replay attacks */
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

/** Maximum webhook requests per IP per minute (rate limit) */
const WEBHOOK_RATE_LIMIT_PER_IP_PER_MINUTE = 60;

// ---------------------------------------------------------------------------
// checkWebhookRateLimit — per-IP throttle using THROTTLE_KV
// Returns true if the request is allowed, false if rate-limited.
// Pattern mirrors checkAndIncrementThrottle from usage-tracking.service.ts.
// ---------------------------------------------------------------------------
async function checkWebhookRateLimit(
  throttleKv: KVNamespace,
  clientIp: string,
): Promise<boolean> {
  const now = new Date();
  const minuteBucket = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const key = `webhook-rate:${clientIp}:${minuteBucket}`;

  const raw = await throttleKv.get(key);
  const currentCount = raw ? parseInt(raw, 10) : 0;

  if (currentCount >= WEBHOOK_RATE_LIMIT_PER_IP_PER_MINUTE) {
    return false;
  }

  await throttleKv.put(key, String(currentCount + 1), { expirationTtl: 120 });
  return true;
}

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /wompi — Receive Wompi payment events (NO auth — HMAC only)
// ---------------------------------------------------------------------------
webhookRoutes.post("/wompi", async (c) => {
  // 0. Per-IP rate limit check — BEFORE CPU-intensive HMAC verification
  const clientIp = c.req.header("cf-connecting-ip") ?? "unknown";
  const rateLimitAllowed = await checkWebhookRateLimit(c.env.THROTTLE_KV, clientIp);
  if (!rateLimitAllowed) {
    return c.json({ error: "rate_limit_exceeded" }, 429);
  }

  // 1. Extract required headers for HMAC verification
  const transactionHash = c.req.header("x-transaction-hash");
  const timestamp = c.req.header("timestamp");

  if (!transactionHash) {
    return c.json({ error: "Missing x-transaction-hash header" }, 400);
  }
  if (!timestamp) {
    return c.json({ error: "Missing timestamp header" }, 400);
  }

  // 2. Validate timestamp freshness to prevent replay attacks
  const parsedTimestamp = Date.parse(timestamp);
  if (Number.isNaN(parsedTimestamp)) {
    return c.json({ error: "Webhook timestamp expired" }, 400);
  }
  const timestampAge = Math.abs(Date.now() - parsedTimestamp);
  if (timestampAge > MAX_WEBHOOK_AGE_MS) {
    return c.json({ error: "Webhook timestamp expired" }, 400);
  }

  // 3. Read raw body as text for signature verification
  const rawBody = await c.req.text();

  // 4. Parse body as JSON for event processing
  let payload: WompiWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WompiWebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // 5. Extract organizationId from Wompi payload data BEFORE signature verification
  // We need the orgId to look up the per-organization integrity key from KV Vault.
  // The reference field contains "{orgId}:{planId}:{timestamp}" format
  const reference = payload.data.transaction.reference;
  const organizationId = extractOrganizationIdFromReference(reference);

  if (!organizationId) {
    return c.json({ error: "Cannot determine organization from payload" }, 400);
  }

  // 6. Resolve per-organization Wompi integrity key from KV Vault, fallback to env var
  const orgIntegrityKey = await c.env.SECRETS_VAULT.get(
    `${organizationId}:secret:wompi_event_integrity_key`,
  );
  const resolvedIntegrityKey = orgIntegrityKey ?? c.env.WOMPI_EVENT_INTEGRITY_KEY;

  // 7. Verify HMAC-SHA256 signature using the per-org (or fallback) integrity key
  const isValid = await verifyWebhookSignature(
    resolvedIntegrityKey,
    rawBody,
    timestamp,
    transactionHash,
  );

  if (!isValid) {
    return c.json({ error: "invalid_signature" }, 400);
  }

  // 8. Process the webhook event (idempotent)
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