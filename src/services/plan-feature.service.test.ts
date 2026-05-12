import { describe, it, expect } from "vitest";
import {
  getPlanFeatures,
  hasFeature,
  getDeviceLimit,
  getReadingsPerHourLimit,
  PLAN_FEATURES,
} from "./plan-feature.service";
import type { PlanName, FeatureName } from "../types/billing.types";

// ---------------------------------------------------------------------------
// PLAN_FEATURES constant — correct structure and values
// ---------------------------------------------------------------------------
describe("PLAN_FEATURES constant", () => {
  it("defines all four plans", () => {
    const planNames: PlanName[] = ["trial", "starter", "professional", "enterprise"];
    for (const name of planNames) {
      expect(PLAN_FEATURES[name]).toBeDefined();
    }
  });

  it("trial plan has correct feature values", () => {
    const trial = PLAN_FEATURES.trial;
    expect(trial.maxDevices).toBe(3);
    expect(trial.readingsPerHour).toBe(1);
    expect(trial.dataRetentionDays).toBe(7);
    expect(trial.alertLevels).toEqual(["p0", "p1"]);
    expect(trial.features).toEqual([]);
  });

  it("starter plan has correct feature values", () => {
    const starter = PLAN_FEATURES.starter;
    expect(starter.maxDevices).toBe(5);
    expect(starter.readingsPerHour).toBe(60);
    expect(starter.dataRetentionDays).toBe(30);
    expect(starter.alertLevels).toEqual(["p0", "p1", "p2", "p3"]);
    expect(starter.features).toEqual([]);
  });

  it("professional plan has correct feature values", () => {
    const pro = PLAN_FEATURES.professional;
    expect(pro.maxDevices).toBe(15);
    expect(pro.readingsPerHour).toBe(720);
    expect(pro.dataRetentionDays).toBe(90);
    expect(pro.alertLevels).toEqual(["p0", "p1", "p2", "p3"]);
    expect(pro.features).toEqual(["ai_diagnostic", "compliance_reports", "advanced_escalation"]);
  });

  it("enterprise plan has Infinity for devices and readings", () => {
    const ent = PLAN_FEATURES.enterprise;
    expect(ent.maxDevices).toBe(Infinity);
    expect(ent.readingsPerHour).toBe(Infinity);
    expect(ent.dataRetentionDays).toBe(365);
    expect(ent.alertLevels).toEqual(["p0", "p1", "p2", "p3"]);
    expect(ent.features).toEqual(["ai_diagnostic", "compliance_reports", "advanced_escalation"]);
  });
});

// ---------------------------------------------------------------------------
// getPlanFeatures — returns the correct PlanFeatures for each plan
// ---------------------------------------------------------------------------
describe("getPlanFeatures", () => {
  it("returns trial features", () => {
    const features = getPlanFeatures("trial");
    expect(features.maxDevices).toBe(3);
    expect(features.readingsPerHour).toBe(1);
  });

  it("returns starter features", () => {
    const features = getPlanFeatures("starter");
    expect(features.maxDevices).toBe(5);
    expect(features.readingsPerHour).toBe(60);
  });

  it("returns professional features", () => {
    const features = getPlanFeatures("professional");
    expect(features.maxDevices).toBe(15);
    expect(features.readingsPerHour).toBe(720);
  });

  it("returns enterprise features with Infinity limits", () => {
    const features = getPlanFeatures("enterprise");
    expect(features.maxDevices).toBe(Infinity);
    expect(features.readingsPerHour).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// hasFeature — returns true only when the plan includes the feature
// ---------------------------------------------------------------------------
describe("hasFeature", () => {
  const allFeatures: FeatureName[] = ["ai_diagnostic", "compliance_reports", "advanced_escalation"];

  it("returns false for all features on trial plan", () => {
    for (const feature of allFeatures) {
      expect(hasFeature("trial", feature)).toBe(false);
    }
  });

  it("returns false for all features on starter plan", () => {
    for (const feature of allFeatures) {
      expect(hasFeature("starter", feature)).toBe(false);
    }
  });

  it("returns true for all features on professional plan", () => {
    for (const feature of allFeatures) {
      expect(hasFeature("professional", feature)).toBe(true);
    }
  });

  it("returns true for all features on enterprise plan", () => {
    for (const feature of allFeatures) {
      expect(hasFeature("enterprise", feature)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getDeviceLimit — returns the maxDevices for each plan
// ---------------------------------------------------------------------------
describe("getDeviceLimit", () => {
  it("returns 3 for trial", () => {
    expect(getDeviceLimit("trial")).toBe(3);
  });

  it("returns 5 for starter", () => {
    expect(getDeviceLimit("starter")).toBe(5);
  });

  it("returns 15 for professional", () => {
    expect(getDeviceLimit("professional")).toBe(15);
  });

  it("returns Infinity for enterprise", () => {
    expect(getDeviceLimit("enterprise")).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// getReadingsPerHourLimit — returns the readingsPerHour for each plan
// ---------------------------------------------------------------------------
describe("getReadingsPerHourLimit", () => {
  it("returns 1 for trial", () => {
    expect(getReadingsPerHourLimit("trial")).toBe(1);
  });

  it("returns 60 for starter", () => {
    expect(getReadingsPerHourLimit("starter")).toBe(60);
  });

  it("returns 720 for professional", () => {
    expect(getReadingsPerHourLimit("professional")).toBe(720);
  });

  it("returns Infinity for enterprise", () => {
    expect(getReadingsPerHourLimit("enterprise")).toBe(Infinity);
  });
});