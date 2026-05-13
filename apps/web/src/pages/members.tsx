import { useState } from "react";
import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";
import { useMembers, useUpdatePermissions } from "@/hooks/use-members";
import { usePermissions } from "@/hooks/use-permissions";
import { PERMISSION_LABELS, PERMISSION_GROUPS, ALL_PERMISSIONS, ROLE_LABELS, type Permission } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Users, Shield, X } from "lucide-react";

export function MembersPage() {
  const { data: membersData, isLoading } = useMembers();
  const { isAdmin } = usePermissions();
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  const members = membersData?.members ?? [];
  const editingMember = members.find((m) => m.id === editingMemberId);

  if (!isAdmin) {
    return (
      <div>
        <Header title="Miembros" />
        <div className="p-8">
          <GlassCard>
            <div className="text-center py-12">
              <Shield size={48} className="mx-auto text-text-muted mb-4" />
              <p className="text-text-secondary">No tenes permisos para gestionar miembros</p>
              <p className="text-text-muted text-sm mt-1">Contacta a un administrador</p>
            </div>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Miembros" />
      <div className="p-8 space-y-6">
        <p className="text-text-secondary text-sm">
          {members.length} miembros en la organizacion
        </p>

        {isLoading ? (
          <GlassCard>
            <p className="text-text-muted text-center py-8">Cargando miembros...</p>
          </GlassCard>
        ) : members.length > 0 ? (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block">
              <GlassCard>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-text-muted font-medium pb-3">ID</th>
                      <th className="text-left text-text-muted font-medium pb-3">Rol</th>
                      <th className="text-left text-text-muted font-medium pb-3">Permisos</th>
                      <th className="text-left text-text-muted font-medium pb-3">Estado</th>
                      <th className="text-right text-text-muted font-medium pb-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="border-b border-white/5 last:border-0">
                        <td className="py-3 text-text-primary font-mono text-xs">{member.supabaseUserId.slice(0, 12)}...</td>
                        <td className="py-3">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-medium", {
                            "bg-accent/10 text-accent": member.role === "admin" || member.role === "admin_vilcami",
                            "bg-surface-elevated text-text-secondary": member.role === "user",
                          })}>
                            {ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {(member.role === "admin" || member.role === "admin_vilcami"
                              ? ALL_PERMISSIONS
                              : JSON.parse(member.permissions || "[]")
                            ).map((p: Permission) => (
                              <span key={p} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                                {PERMISSION_LABELS[p] ?? p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-medium", {
                            "bg-accent/10 text-accent": member.status === "active",
                            "bg-surface-elevated text-text-muted": member.status !== "active",
                          })}>
                            {member.status === "active" ? "Activo" : member.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {member.role === "user" && (
                            <button
                              onClick={() => setEditingMemberId(member.id)}
                              className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
                            >
                              Editar permisos
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </GlassCard>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {members.map((member) => (
                <GlassCard key={member.id} hover className="animate-fade-in">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-mono text-xs text-text-primary">{member.supabaseUserId.slice(0, 16)}...</p>
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium mt-1 inline-block", {
                        "bg-accent/10 text-accent": member.role === "admin" || member.role === "admin_vilcami",
                        "bg-surface-elevated text-text-secondary": member.role === "user",
                      })}>
                        {ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}
                      </span>
                    </div>
                    <span className={cn("px-2 py-0.5 rounded text-xs font-medium", {
                      "bg-accent/10 text-accent": member.status === "active",
                      "bg-surface-elevated text-text-muted": member.status !== "active",
                    })}>
                      {member.status === "active" ? "Activo" : member.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(member.role === "admin" || member.role === "admin_vilcami"
                      ? ALL_PERMISSIONS
                      : JSON.parse(member.permissions || "[]")
                    ).map((p: Permission) => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                        {PERMISSION_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                  {member.role === "user" && (
                    <button
                      onClick={() => setEditingMemberId(member.id)}
                      className="mt-3 w-full py-2 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
                    >
                      Editar permisos
                    </button>
                  )}
                </GlassCard>
              ))}
            </div>
          </>
        ) : (
          <GlassCard>
            <div className="text-center py-12">
              <Users size={48} className="mx-auto text-text-muted mb-4" />
              <p className="text-text-secondary">No hay miembros</p>
            </div>
          </GlassCard>
        )}

        {editingMember && (
          <EditPermissionsModal
            member={editingMember}
            onClose={() => setEditingMemberId(null)}
          />
        )}
      </div>
    </div>
  );
}

function EditPermissionsModal({
  member,
  onClose,
}: {
  member: { id: string; supabaseUserId: string; permissions: string; role: string };
  onClose: () => void;
}) {
  const updatePermissions = useUpdatePermissions();
  const initialPermissions: Permission[] = JSON.parse(member.permissions || "[]");
  const [selected, setSelected] = useState<Set<Permission>>(new Set(initialPermissions));

  const toggle = (permission: Permission) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  };

  const handleSave = async () => {
    await updatePermissions.mutateAsync({
      memberId: member.id,
      permissions: Array.from(selected),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <GlassCard variant="strong" className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Editar permisos</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4 font-mono">
          {member.supabaseUserId.slice(0, 16)}...
        </p>

        <div className="space-y-5">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.key}>
              <p className="text-sm font-medium text-text-primary mb-2">{group.label}</p>
              <div className="space-y-2">
                {group.permissions.map((permission) => (
                  <label key={permission} className="flex items-center gap-3 cursor-pointer group">
                    <button
                      onClick={() => toggle(permission)}
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                        selected.has(permission)
                          ? "bg-accent border-accent text-white"
                          : "border-white/20 group-hover:border-white/40"
                      )}
                    >
                      {selected.has(permission) && (
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10.28 2.28L3.989 8.575 1.648 6.235a.5.5 0 00-.707.707l2.646 2.646a.5.5 0 00.707 0l6.692-6.692a.5.5 0 00-.707-.707z" />
                        </svg>
                      )}
                    </button>
                    <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
                      {PERMISSION_LABELS[permission]}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-surface-elevated border border-white/10 text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={updatePermissions.isPending}
            className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
          >
            {updatePermissions.isPending ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}