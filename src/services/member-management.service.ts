import { getDrizzleDb } from "../utils/db.util";
import { organizationMembers } from "../schema/organization-members";
import { eq, and } from "drizzle-orm";
import type { Env } from "../types/env";
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