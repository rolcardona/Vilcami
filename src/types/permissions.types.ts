export type Permission =
  | "devices:create"
  | "devices:update"
  | "devices:delete"
  | "telemetry:ingest"
  | "alerts:acknowledge"
  | "alerts:resolve"
  | "alerts:shelve"
  | "billing:manage";

export const ALL_PERMISSIONS: Permission[] = [
  "devices:create",
  "devices:update",
  "devices:delete",
  "telemetry:ingest",
  "alerts:acknowledge",
  "alerts:resolve",
  "alerts:shelve",
  "billing:manage",
];

export const DEFAULT_USER_PERMISSIONS: Permission[] = ["telemetry:ingest"];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "devices:create": "Crear dispositivos",
  "devices:update": "Modificar dispositivos",
  "devices:delete": "Eliminar dispositivos",
  "telemetry:ingest": "Enviar telemetria",
  "alerts:acknowledge": "Reconocer alertas",
  "alerts:resolve": "Resolver alertas",
  "alerts:shelve": "Posponer alertas",
  "billing:manage": "Gestionar facturacion",
};

export function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS.includes(value as Permission);
}

export function parsePermissions(json: string): Permission[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return DEFAULT_USER_PERMISSIONS;
    return parsed.filter(isPermission);
  } catch {
    return DEFAULT_USER_PERMISSIONS;
  }
}