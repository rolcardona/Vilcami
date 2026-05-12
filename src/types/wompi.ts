// ---------------------------------------------------------------------------
// Wompi API integration types — Phase 5
// Sandbox-first: never advance to production without explicit user confirmation.
// ---------------------------------------------------------------------------

/** Request body sent to POST /v1/payment_links */
export interface WompiPaymentLinkRequest {
  amountInCents: number;
  currency: "COP";
  reference: string;
  publicKey: string;
  redirectUrl: string;
  expirationDate?: string;
}

/** Response from Wompi payment link creation */
export interface WompiPaymentLinkResponse {
  id: string;
  url: string;
  reference: string;
  expiresAt: string;
}

/** Wompi transaction entity — appears in webhook payloads */
export interface WompiTransaction {
  id: string;
  amountInCents: number;
  currency: string;
  status: string;
  paymentMethod: string;
  reference: string;
  createdAt: string;
}

/** Incoming Wompi webhook payload — POST /api/webhooks/wompi */
export interface WompiWebhookPayload {
  event: string;
  data: {
    transaction: WompiTransaction;
  };
  timestamp: string;
  signature: {
    checksum: string;
    properties: string[];
  };
}

/** Wompi webhook HTTP headers used for HMAC-SHA256 verification */
export interface WompiWebhookHeaders {
  "x-transaction-hash": string;
  timestamp: string;
}