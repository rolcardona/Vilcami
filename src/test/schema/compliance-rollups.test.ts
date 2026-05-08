import { describe, it, expect } from "vitest";
import { complianceTemplates, complianceRegulationEnum } from "../../schema/compliance-templates";
import { complianceReports } from "../../schema/compliance-reports";
import { hourlyAverages } from "../../schema/hourly-averages";
import { dailySummaries } from "../../schema/daily-summaries";
import { weatherCache } from "../../schema/weather-cache";

describe("compliance_templates schema", () => {
  it("should have regulation enum and thresholds JSON", () => {
    const columnNames = Object.keys(complianceTemplates);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("regulation");
    expect(columnNames).toContain("thresholds");
    expect(columnNames).toContain("reportSchedule");
  });

  it("should have regulation enum with HACCP, INVIMA, EN12830, CFIA", () => {
    expect(complianceRegulationEnum.config.enumValues).toEqual([
      "HACCP", "INVIMA_DEC1500", "EN12830", "CFIA_PREVENTIVE_CONTROLS"
    ]);
  });
});

describe("compliance_reports schema", () => {
  it("should have report type and status columns", () => {
    const columnNames = Object.keys(complianceReports);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("templateId");
    expect(columnNames).toContain("reportType");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("pdfUrl");
  });
});

describe("hourly_averages schema", () => {
  it("should have aggregation columns", () => {
    const columnNames = Object.keys(hourlyAverages);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("avgValue");
    expect(columnNames).toContain("minValue");
    expect(columnNames).toContain("maxValue");
    expect(columnNames).toContain("sampleCount");
  });
});

describe("daily_summaries schema", () => {
  it("should have stdDev and alertCount", () => {
    const columnNames = Object.keys(dailySummaries);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("stdDev");
    expect(columnNames).toContain("alertCount");
    expect(columnNames).toContain("dateBucket");
  });
});

describe("weather_cache schema", () => {
  it("should have weather data columns", () => {
    const columnNames = Object.keys(weatherCache);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("temperatureCelsius");
    expect(columnNames).toContain("expiresAt");
  });
});