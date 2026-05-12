import { z } from "zod";

// ---------------------------------------------------------------------------
// Plan name — must match billing.types PlanName union
// ---------------------------------------------------------------------------
export const planNameValidator = z.enum([
  "trial",
  "starter",
  "professional",
  "enterprise",
]);

// ---------------------------------------------------------------------------
// Billing event — tracks API call counts for usage-based billing
// ---------------------------------------------------------------------------
export const billingEventValidator = z.object({
  organizationId: z.string().min(1),
  deviceSubscriptionId: z.string().min(1),
  eventType: z.enum(["api_call_tuya", "api_call_modbus"]),
  deviceExternalId: z.string().min(1),
  sensorCount: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// Checkout request — POST /api/billing/checkout
// ---------------------------------------------------------------------------
export const checkoutRequestValidator = z.object({
  planId: z.string().min(1),
  deviceCount: z.number().int().min(1).max(100),
  returnUrl: z.string().url(),
}).strict();

// ---------------------------------------------------------------------------
// Wompi webhook payload — POST /api/webhooks/wompi
// ---------------------------------------------------------------------------
export const wompiWebhookValidator = z.object({
  event: z.string().min(1),
  data: z.object({
    transaction: z.object({
      id: z.string().min(1),
      amountInCents: z.number().int().positive(),
      currency: z.string().min(1),
      status: z.string().min(1),
      paymentMethod: z.string(),
      reference: z.string().min(1),
      createdAt: z.string().min(1),
    }),
  }),
  timestamp: z.string().min(1),
  signature: z.object({
    checksum: z.string().min(1),
    properties: z.array(z.string()),
  }),
});

// ---------------------------------------------------------------------------
// Payment query — GET /api/billing/payments
// ---------------------------------------------------------------------------
export const paymentQueryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type CheckoutRequestInput = z.infer<typeof checkoutRequestValidator>;
export type WompiWebhookInput = z.infer<typeof wompiWebhookValidator>;
export type PaymentQueryInput = z.infer<typeof paymentQueryValidator>;