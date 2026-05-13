export const SEVERITY = {
  critical: { label: "Critico", color: "text-danger", bg: "bg-danger/10", dot: "bg-danger" },
  high: { label: "Alto", color: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  medium: { label: "Medio", color: "text-info", bg: "bg-info/10", dot: "bg-info" },
  low: { label: "Bajo", color: "text-text-secondary", bg: "bg-surface-elevated", dot: "bg-text-muted" },
} as const;

export type Severity = keyof typeof SEVERITY;

export const PLAN_NAMES = ["trial", "starter", "professional", "enterprise"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export const PLAN_LABELS: Record<PlanName, string> = {
  trial: "Prueba",
  starter: "Starter",
  professional: "Profesional",
  enterprise: "Empresa",
};

export const SUBSCRIPTION_STATUS = {
  trial: { label: "Prueba", color: "text-info" },
  active: { label: "Activa", color: "text-accent" },
  past_due: { label: "Vencida", color: "text-warning" },
  suspended: { label: "Suspendida", color: "text-danger" },
  cancelled: { label: "Cancelada", color: "text-text-muted" },
} as const;

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

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

export const PERMISSION_GROUPS = [
  { key: "devices", label: "Dispositivos", permissions: ["devices:create", "devices:update", "devices:delete"] as Permission[] },
  { key: "telemetry", label: "Telemetria", permissions: ["telemetry:ingest"] as Permission[] },
  { key: "alerts", label: "Alertas", permissions: ["alerts:acknowledge", "alerts:resolve", "alerts:shelve"] as Permission[] },
  { key: "billing", label: "Facturacion", permissions: ["billing:manage"] as Permission[] },
] as const;

export type Role = "admin_vilcami" | "admin" | "user";

export const ROLE_LABELS: Record<Role, string> = {
  admin_vilcami: "Super Admin",
  admin: "Administrador",
  user: "Usuario",
};