import { describe, it, expect } from "vitest";
import { organizationMembers } from "../../schema/organization-members";

describe("organization_members schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(organizationMembers);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("organizationId");
    expect(columnNames).toContain("supabaseUserId");
    expect(columnNames).toContain("role");
    expect(columnNames).toContain("status");
  });

  it("should have role enum with admin_vilcami, admin, user", () => {
    expect(organizationMembers.role.enumValues).toEqual(["admin_vilcami", "admin", "user"]);
  });

  it("should have status enum with active, suspended", () => {
    expect(organizationMembers.status.enumValues).toEqual(["active", "suspended"]);
  });

  it("should have organizationId as not null", () => {
    expect(organizationMembers.organizationId.notNull).toBe(true);
  });
});