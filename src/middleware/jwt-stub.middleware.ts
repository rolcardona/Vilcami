export interface JwtPayload {
  sub: string;
  org_id: string;
  role: "admin_vilcami" | "admin" | "user";
  mfa_verified: boolean;
}

export interface MfaVerificationResult {
  authorized: boolean;
  statusCode?: number;
  message?: string;
}

export function extractJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  const payload = JSON.parse(atob(parts[1]));
  return {
    sub: payload.sub,
    org_id: payload.org_id,
    role: payload.role,
    mfa_verified: payload.mfa_verified ?? false,
  };
}

export function verifyMfaForAdmin(payload: JwtPayload): MfaVerificationResult {
  if (payload.role === "admin" && !payload.mfa_verified) {
    return {
      authorized: false,
      statusCode: 403,
      message: "Admin role requires MFA verification",
    };
  }
  return { authorized: true };
}

export function getOrganizationFilter(payload: JwtPayload): string | null {
  if (payload.role === "admin_vilcami") {
    return null;
  }
  return payload.org_id;
}