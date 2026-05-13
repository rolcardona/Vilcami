import { api } from "./client";

export interface Plan {
  name: string;
  label: string;
  maxDevices: number;
  readingsPerHour: number;
  dataRetentionDays: number;
  alertLevels: number;
  features: string[];
  priceInCents: number;
}

export interface Subscription {
  organizationId: string;
  planName: string;
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  deviceCount: number;
  maxDevices: number;
}

export interface Payment {
  id: string;
  organizationId: string;
  amountInCents: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  paymentMethod: string;
  planId: string;
  deviceCount: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  createdAt: string;
}

export const billingApi = {
  getPlans: () => api.get("billing/plans").json<Plan[]>(),
  getSubscription: () => api.get("billing/subscription").json<Subscription>(),
  getPayments: (limit = 20, offset = 0) =>
    api.get("billing/payments", { searchParams: { limit: String(limit), offset: String(offset) } }).json<{ payments: Payment[]; total: number }>(),
  checkout: (planId: string, deviceCount: number, returnUrl: string) =>
    api.post("billing/checkout", { json: { planId, deviceCount, returnUrl } }).json<{ url: string; reference: string }>(),
};