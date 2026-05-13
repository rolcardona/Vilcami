import type { Context, Next } from "hono";
import type { Env } from "../types/env";
import type { JwtPayload } from "../auth/jwt-verifier";
import type { Permission } from "../types/permissions.types";
import { ALL_PERMISSIONS, parsePermissions } from "../types/permissions.types";
import { getDrizzleDb } from "../utils/db.util";
import { organizationMembers } from "../schema/organization-members";
import { eq, and } from "drizzle-orm";

export type { Permission };

/**
 * Middleware factory that checks if the authenticated user has a specific permission.
 *
 * - admin_vilcami and admin: always pass (all permissions granted by role).
 * - user: checks the permissions column in organization_members.
 *
 * MUST run after authMiddleware and orgScopingMiddleware.
 */
export function requirePermission(permission: Permission) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const jwtPayload = c.get("jwtPayload") as JwtPayload;

    // admin_vilcami and admin always have all permissions
    if (jwtPayload.role === "admin_vilcami" || jwtPayload.role === "admin") {
      c.set("memberPermissions" as never, ALL_PERMISSIONS);
      await next();
      return;
    }

    // user role: check permissions from organization_members
    const organizationId = c.get("organizationId") as string;
    if (!organizationId) {
      return c.json({ error: "permission_denied", required: permission, message: "Missing organization context" }, 403);
    }

    const db = getDrizzleDb(c.env);
    const member = await db
      .select({ permissions: organizationMembers.permissions })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.supabaseUserId, jwtPayload.sub),
          eq(organizationMembers.organizationId, organizationId),
        ),
      )
      .get();

    if (!member) {
      return c.json({ error: "permission_denied", required: permission, message: "User not found in organization" }, 403);
    }

    const userPermissions = parsePermissions(member.permissions);
    c.set("memberPermissions" as never, userPermissions);

    if (!userPermissions.includes(permission)) {
      return c.json({
        error: "permission_denied",
        required: permission,
        message: `You do not have the '${permission}' permission. Contact your organization admin.`,
      }, 403);
    }

    await next();
  };
}

// Extend Hono's context variable map
declare module "hono" {
  interface ContextVariableMap {
    memberPermissions: string[];
  }
}