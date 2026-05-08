import { describe, it, expect } from "vitest";
import { extractJwtPayload, verifyMfaForAdmin, getOrganizationFilter } from "../../middleware/jwt-stub.middleware";

describe("JWT Stub Middleware", () => {
  describe("extractJwtPayload", () => {
    it("should extract valid JWT payload", () => {
      // Create a minimal JWT-like token with base64 payload
      const payload = { sub: "user-123", org_id: "org-456", role: "user", mfa_verified: true };
      const encodedPayload = btoa(JSON.stringify(payload));
      const token = `eyJhbGciOiJIUzI1NiJ9.${encodedPayload}.placeholder-signature`;
      const result = extractJwtPayload(token);
      expect(result.sub).toBe("user-123");
      expect(result.org_id).toBe("org-456");
      expect(result.role).toBe("user");
      expect(result.mfa_verified).toBe(true);
    });

    it("should throw on invalid JWT format", () => {
      expect(() => extractJwtPayload("not-a-jwt")).toThrow("Invalid JWT format");
    });

    it("should default mfa_verified to false if missing", () => {
      const payload = { sub: "user-123", org_id: "org-456", role: "user" };
      const encodedPayload = btoa(JSON.stringify(payload));
      const token = `header.${encodedPayload}.sig`;
      const result = extractJwtPayload(token);
      expect(result.mfa_verified).toBe(false);
    });
  });

  describe("verifyMfaForAdmin", () => {
    it("should reject admin without MFA", () => {
      const payload = { sub: "admin-1", org_id: "org-1", role: "admin" as const, mfa_verified: false };
      const result = verifyMfaForAdmin(payload);
      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
    });

    it("should allow admin with MFA", () => {
      const payload = { sub: "admin-1", org_id: "org-1", role: "admin" as const, mfa_verified: true };
      const result = verifyMfaForAdmin(payload);
      expect(result.authorized).toBe(true);
    });

    it("should allow admin_vilcami to see all orgs", () => {
      const payload = { sub: "super-1", org_id: "vilcami", role: "admin_vilcami" as const, mfa_verified: true };
      const result = verifyMfaForAdmin(payload);
      expect(result.authorized).toBe(true);
    });

    it("should allow regular user without MFA check", () => {
      const payload = { sub: "user-1", org_id: "org-1", role: "user" as const, mfa_verified: false };
      const result = verifyMfaForAdmin(payload);
      expect(result.authorized).toBe(true);
    });
  });

  describe("getOrganizationFilter", () => {
    it("should return null for admin_vilcami (sees all orgs)", () => {
      const payload = { sub: "super-1", org_id: "vilcami", role: "admin_vilcami" as const, mfa_verified: true };
      expect(getOrganizationFilter(payload)).toBeNull();
    });

    it("should return org_id for regular admin", () => {
      const payload = { sub: "admin-1", org_id: "org-1", role: "admin" as const, mfa_verified: true };
      expect(getOrganizationFilter(payload)).toBe("org-1");
    });

    it("should return org_id for regular user", () => {
      const payload = { sub: "user-1", org_id: "org-1", role: "user" as const, mfa_verified: false };
      expect(getOrganizationFilter(payload)).toBe("org-1");
    });
  });
});