import { describe, it, expect } from "vitest";
import { alertRules, alertSeverityEnum, alertConditionOperatorEnum } from "../../schema/alert-rules";
import { alertLifecycle, alertLifecycleStatusEnum } from "../../schema/alert-lifecycle";
import { alertEscalations } from "../../schema/alert-escalations";
import { alertAuditLog, alertAuditActionEnum } from "../../schema/alert-audit-log";

describe("alert_rules schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(alertRules);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("severity");
    expect(columnNames).toContain("conditionOperator");
    expect(columnNames).toContain("deadbandValue");
    expect(columnNames).toContain("timeDelaySeconds");
  });

  it("should have severity enum with p0-p3", () => {
    expect(alertSeverityEnum.config.enumValues).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("should have conditionOperator enum", () => {
    expect(alertConditionOperatorEnum.config.enumValues).toEqual(["gt", "lt", "gte", "lte", "eq", "between"]);
  });
});

describe("alert_lifecycle schema", () => {
  it("should have ISA-18.2 status enum", () => {
    expect(alertLifecycleStatusEnum.config.enumValues).toEqual([
      "active", "acknowledged", "returned_to_normal", "shelved", "suppressed", "out_of_service"
    ]);
  });

  it("should have all required columns", () => {
    const columnNames = Object.keys(alertLifecycle);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("triggeredAt");
    expect(columnNames).toContain("acknowledgedBy");
    expect(columnNames).toContain("shelvedUntil");
  });
});

describe("alert_escalations schema", () => {
  it("should have escalation columns", () => {
    const columnNames = Object.keys(alertEscalations);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("alertLifecycleId");
    expect(columnNames).toContain("escalationLevel");
  });
});

describe("alert_audit_log schema", () => {
  it("should have action and performed_by columns", () => {
    const columnNames = Object.keys(alertAuditLog);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("action");
    expect(columnNames).toContain("performedBy");
    expect(columnNames).toContain("details");
  });

  it("should have audit action enum", () => {
    expect(alertAuditActionEnum.config.enumValues).toEqual([
      "triggered", "acknowledged", "escalated", "shelved", "suppressed", "returned_to_normal"
    ]);
  });
});