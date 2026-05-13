import { getDrizzleDb } from "../utils/db.util";
import { organizationMembers } from "../schema/organization-members";
import { eq, and } from "drizzle-orm";
import type { Env } from "../types/env";
import { ALL_PERMISSIONS, DEFAULT_USER_PERMISSIONS, parsePermissions } from "../types/permissions.types";
import type { Permission } from "../types/permissions.types";

interface MemberWithPermissions {
  id: string;
  supabaseUserId: string;
  role: string;
  permissions: string;
  status: string;
  organizationId: string;
}

export async function listMembers(
  env: Env,
  organizationFilter: string | null,
): Promise<MemberWithPermissions[]> {
  const db = getDrizzleDb(env);

  if (organizationFilter) {
    return await db
      .select({
        id: organizationMembers.id,
        supabaseUserId: organizationMembers.supabaseUserId,
        role: organizationMembers.role,
        permissions: organizationMembers.permissions,
        status: organizationMembers.status,
        organizationId: organizationMembers.organizationId,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationFilter));
  }

  return await db
    .select({
      id: organizationMembers.id,
      supabaseUserId: organizationMembers.supabaseUserId,
      role: organizationMembers.role,
      permissions: organizationMembers.permissions,
      status: organizationMembers.status,
      organizationId: organizationMembers.organizationId,
    })
    .from(organizationMembers);
}

export async function getMyPermissions(
  env: Env,
  supabaseUserId: string,
  organizationId: string,
  role: string,
): Promise<{ role: string; permissions: Permission[] }> {
  if (role === "admin_vilcami" || role === "admin") {
    return { role, permissions: [...ALL_PERMISSIONS] };
  }

  const db = getDrizzleDb(env);
  const member = await db
    .select({ permissions: organizationMembers.permissions })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.supabaseUserId, supabaseUserId),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .get();

  if (!member) {
    return { role, permissions: [...DEFAULT_USER_PERMISSIONS] };
  }

  return { role, permissions: parsePermissions(member.permissions) };
}

export async function updateMemberPermissions(
  env: Env,
  memberId: string,
  permissions: Permission[],
  organizationFilter: string | null,
): Promise<{ success: boolean; error?: string }> {
  const db = getDrizzleDb(env);
  const permissionsJson = JSON.stringify(permissions);

  const conditions = organizationFilter
    ? and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, organizationFilter))
    : eq(organizationMembers.id, memberId);

  const result = await db
    .update(organizationMembers)
    .set({ permissions: permissionsJson })
    .where(conditions);

  return { success: true };
}