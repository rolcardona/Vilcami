// ---------------------------------------------------------------------------
// Billing domain types — Phase 5
// ---------------------------------------------------------------------------

/** Available subscription plan names, aligned with PLAN_FEATURES */
export type PlanName = "trial" | "starter" | "professional" | "enterprise";

/** Subscription lifecycle statuses — controls API access levels */
export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

/** Payment record statuses — tracks Wompi transaction lifecycle */
export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

/** Supported payment methods via Wompi (COP market) */
export type PaymentMethod = "card" | "pse" | "nequi";

/** Feature names gated by plan tier — lower tiers purchase as add-ons */
export type FeatureName =
  | "ai_diagnostic"
  | "compliance_reports"
  | "advanced_escalation";

/** Feature set included in each plan tier */
export interface PlanFeatures {
  maxDevices: number;
  readingsPerHour: number;
  dataRetentionDays: number;
  alertLevels: string[];
  features: FeatureName[];
}

/** Client request to create a Wompi payment link */
export interface CheckoutRequest {
  planId: string;
  deviceCount: number;
  returnUrl: string;
}

/** API response for subscription status queries */
export interface SubscriptionResponse {
  organizationId: string;
  planName: PlanName;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  deviceCount: number;
  maxDevices: number;
}

/** API response for payment history entries */
export interface PaymentResponse {
  id: string;
  organizationId: string;
  amountInCents: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  planId: string;
  deviceCount: number;
  billingPeriodStart: number;
  billingPeriodEnd: number;
  createdAt: number;
}