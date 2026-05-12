import type { PlanName, FeatureName, PlanFeatures } from "../types/billing.types";

// ---------------------------------------------------------------------------
// PLAN_FEATURES — canonical plan-to-feature mapping (design spec §3.2)
// ---------------------------------------------------------------------------
export const PLAN_FEATURES: Record<PlanName, PlanFeatures> = {
  trial: {
    maxDevices: 3,
    readingsPerHour: 1,
    dataRetentionDays: 7,
    alertLevels: ["p0", "p1"],
    features: [],
  },
  starter: {
    maxDevices: 5,
    readingsPerHour: 60,
    dataRetentionDays: 30,
    alertLevels: ["p0", "p1", "p2", "p3"],
    features: [],
  },
  professional: {
    maxDevices: 15,
    readingsPerHour: 720,
    dataRetentionDays: 90,
    alertLevels: ["p0", "p1", "p2", "p3"],
    features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"],
  },
  enterprise: {
    maxDevices: Infinity,
    readingsPerHour: Infinity,
    dataRetentionDays: 365,
    alertLevels: ["p0", "p1", "p2", "p3"],
    features: ["ai_diagnostic", "compliance_reports", "advanced_escalation"],
  },
};

/** Returns the full feature set for a given plan */
export function getPlanFeatures(planName: PlanName): PlanFeatures {
  return PLAN_FEATURES[planName];
}

/** Checks whether a plan includes a specific gated feature */
export function hasFeature(planName: PlanName, feature: FeatureName): boolean {
  return PLAN_FEATURES[planName].features.includes(feature);
}

/** Returns the maximum device count allowed for a plan */
export function getDeviceLimit(planName: PlanName): number {
  return PLAN_FEATURES[planName].maxDevices;
}

/** Returns the maximum telemetry readings per hour for a plan */
export function getReadingsPerHourLimit(planName: PlanName): number {
  return PLAN_FEATURES[planName].readingsPerHour;
}