import { api } from "./client";
import type { Permission } from "@/lib/constants";

export interface MyPermissionsResponse {
  role: string;
  permissions: Permission[];
}

export interface MemberResponse {
  id: string;
  supabaseUserId: string;
  role: string;
  permissions: string;
  status: string;
  organizationId: string;
}

export const membersApi = {
  getMyPermissions: () =>
    api.get("members/me").json<MyPermissionsResponse>(),

  listMembers: () =>
    api.get("members").json<{ members: MemberResponse[] }>(),

  updatePermissions: (memberId: string, permissions: Permission[]) =>
    api.patch(`members/${memberId}/permissions`, { json: { permissions } }).json<{ success: boolean; memberId: string; permissions: Permission[] }>(),
};