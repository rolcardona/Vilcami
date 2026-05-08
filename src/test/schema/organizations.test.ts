import { describe, it, expect } from "vitest";
import { organizations } from "../../schema/organizations";

describe("organizations schema", () => {
  it("should have all required columns", () => {
    const columnNames = Object.keys(organizations);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("countryCode");
    expect(columnNames).toContain("currencyCode");
    expect(columnNames).toContain("d1DatabaseId");
    expect(columnNames).toContain("createdAt");
  });

  it("should use text as primary key type for id", () => {
    expect(organizations.id.dataType).toBe("string");
  });

  it("should have countryCode as not null", () => {
    expect(organizations.countryCode.notNull).toBe(true);
  });

  it("should have currencyCode as not null", () => {
    expect(organizations.currencyCode.notNull).toBe(true);
  });
});