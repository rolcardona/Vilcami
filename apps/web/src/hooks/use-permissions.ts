import { useAuth } from "@/auth/auth-provider";
import { ALL_PERMISSIONS, type Permission, type Role } from "@/lib/constants";

export function usePermissions() {
  const { role, permissions } = useAuth();

  const isAdmin = role === "admin_vilcami" || role === "admin";
  const effectivePermissions = isAdmin ? ALL_PERMISSIONS : permissions;

  const hasPermission = (permission: Permission): boolean => {
    if (isAdmin) return true;
    return effectivePermissions.includes(permission);
  };

  return {
    role: role as Role | null,
    permissions: effectivePermissions,
    isAdmin,
    hasPermission,
  };
}

export function useHasPermission(permission: Permission): boolean {
  const { hasPermission } = usePermissions();
  return hasPermission(permission);
}